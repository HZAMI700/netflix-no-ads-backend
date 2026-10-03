/** Entrypoint: config → engine → registry → routes → listen. Graceful shutdown included. */
import { rm } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { configureFfmpeg } from './media/ffmpeg.js';
import { buildApp } from './server.js';
import { StreamRegistry } from './streams/registry.js';
import { WebTorrentEngine } from './torrent/webtorrent-engine.js';

async function main(): Promise<void> {
  const config = loadConfig();
  configureFfmpeg(config.ffmpegPath);

  const engine = new WebTorrentEngine();
  const registry = new StreamRegistry({
    maxActive: config.maxActiveStreams,
    ttlMs: config.streamTtlMs,
    destroy: async (session) => {
      try {
        await session.engineHandle.destroy();
      } catch {
        /* already gone */
      }
      try {
        await rm(session.downloadPath, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  });

  const app = buildApp({ config, engine, registry });

  // Expire idle streams every minute.
  const sweeper = setInterval(() => {
    registry
      .sweep()
      .then((expired) => {
        for (const id of expired) app.log.info({ id }, 'stream expired');
      })
      .catch((err: unknown) => app.log.error(err));
  }, 60_000);
  sweeper.unref?.();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(sweeper);
    await registry.shutdownAll();
    await engine.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
