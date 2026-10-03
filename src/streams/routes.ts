/**
 * Stream endpoints. No filesystem paths or secrets ever leave the server:
 * clients only see opaque ids, file names and public stream URLs.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { contentTypeFor, isDirectPlayable, mp4NameFor } from '../media/content-type.js';
import { transcodeToMp4 } from '../media/ffmpeg.js';
import { parseMagnet, sanitizeFilename } from '../torrent/validator.js';
import type { TorrentEngine } from '../torrent/types.js';
import { parseRange } from './range.js';
import { StreamError, type StreamRegistry } from './registry.js';

export interface RouteDeps {
  config: AppConfig;
  engine: TorrentEngine;
  registry: StreamRegistry;
}

async function removeDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export function registerStreamRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, engine, registry } = deps;

  app.post<{ Body: { magnet?: unknown; fileIndex?: unknown } }>(
    '/api/stream',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['magnet'],
          additionalProperties: false,
          properties: {
            magnet: { type: 'string', minLength: 20, maxLength: 4096 },
            fileIndex: { type: 'integer', minimum: 0, maximum: 9999 },
          },
        },
      },
    },
    async (req, reply) => {
      const { magnet, fileIndex } = req.body;
      let infoHash: string;
      try {
        infoHash = parseMagnet(magnet).infoHash;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      if (registry.count() >= config.maxActiveStreams) {
        return reply.code(429).send({ error: 'Server is busy: too many active streams, try again later' });
      }

      const downloadPath = path.join(config.tempDir, randomUUID());
      let handle;
      try {
        handle = await engine.add(magnet as string, {
          downloadPath,
          metadataTimeoutMs: config.metadataTimeoutMs,
        });
      } catch (err) {
        await removeDir(downloadPath);
        req.log.warn({ infoHash }, `metadata fetch failed: ${(err as Error).message}`);
        return reply.code(502).send({ error: 'Could not fetch torrent metadata (no seeds or network issue)' });
      }

      const wanted =
        typeof fileIndex === 'number'
          ? handle.files.find((f) => f.index === fileIndex)
          : handle.files.length > 0
            ? handle.files.reduce((a, b) => (b.length > a.length ? b : a))
            : undefined;
      if (!wanted) {
        await handle.destroy().catch(() => undefined);
        await removeDir(downloadPath);
        return reply.code(400).send({ error: 'Requested file not found in torrent' });
      }
      if (wanted.length > config.maxFileSizeBytes) {
        await handle.destroy().catch(() => undefined);
        await removeDir(downloadPath);
        return reply
          .code(413)
          .send({ error: `File too large (${(wanted.length / 1024 ** 3).toFixed(2)} GB exceeds the server limit)` });
      }

      const fileName = sanitizeFilename(wanted.name);
      try {
        const session = registry.create({
          fileName,
          fileSize: wanted.length,
          fileIndex: wanted.index,
          mimeType: contentTypeFor(fileName),
          direct: isDirectPlayable(fileName),
          engineHandle: handle,
          downloadPath,
        });
        req.log.info({ id: session.id, infoHash, fileName }, 'stream created');
        return reply.code(201).send({
          id: session.id,
          streamUrl: `${config.publicBaseUrl}/api/stream/${session.id}`,
          fileName: session.fileName,
          fileSize: session.fileSize,
          mimeType: session.mimeType,
          direct: session.direct,
        });
      } catch (err) {
        await handle.destroy().catch(() => undefined);
        await removeDir(downloadPath);
        if (err instanceof StreamError) return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }
    },
  );

  app.get('/api/stream/:id/info', async (req, reply) => {
    const { id } = req.params as { id: string };
    let session;
    try {
      session = registry.touch(id);
    } catch (err) {
      if (err instanceof StreamError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
    return reply.send({
      id: session.id,
      fileName: session.fileName,
      fileSize: session.fileSize,
      mimeType: session.mimeType,
      direct: session.direct,
      peers: session.engineHandle.numPeers,
      progress: session.engineHandle.progress,
      downloadSpeed: session.engineHandle.downloadSpeed,
    });
  });

  app.get('/api/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    let session;
    try {
      session = registry.get(id);
    } catch (err) {
      if (err instanceof StreamError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }

    // Non-playable containers: FFmpeg transcodes to fragmented MP4 on the fly.
    // Transcoded output cannot honor byte ranges, so seeking is unavailable here.
    if (!session.direct) {
      reply.hijack();
      registry.touch(id);
      const outName = mp4NameFor(session.fileName);
      reply.raw.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'none',
        'Content-Disposition': `inline; filename="${outName}"`,
        'Cache-Control': 'no-store',
      });
      let source;
      try {
        source = session.engineHandle.createReadStream(session.fileIndex, 0);
      } catch {
        reply.raw.destroy();
        return;
      }
      const job = transcodeToMp4(source, { preset: config.transcodePreset });
      const cleanup = (): void => job.kill();
      reply.raw.on('close', cleanup);
      job.stream.on('error', cleanup);
      job.stream.pipe(reply.raw);
      return;
    }

    const total = session.fileSize;
    const parsed = parseRange(req.headers.range, total);
    if (parsed === null) {
      return reply
        .code(416)
        .header('Content-Range', `bytes */${total}`)
        .send({ error: 'Requested range not satisfiable' });
    }
    registry.touch(id);
    const start = parsed === 'none' ? 0 : parsed.start;
    const end = parsed === 'none' ? total - 1 : parsed.end;

    reply.hijack();
    reply.raw.writeHead(parsed === 'none' ? 200 : 206, {
      'Content-Type': session.mimeType,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...(parsed === 'none' ? {} : { 'Content-Range': `bytes ${start}-${end}/${total}` }),
      'Content-Disposition': `inline; filename="${session.fileName}"`,
      'Cache-Control': 'no-store',
    });
    let fileStream;
    try {
      fileStream = session.engineHandle.createReadStream(session.fileIndex, start, end);
    } catch {
      reply.raw.destroy();
      return;
    }
    fileStream.on('error', () => {
      try {
        reply.raw.destroy();
      } catch {
        /* socket already gone */
      }
    });
    // Abort the piece stream when the browser navigates away; the session survives for seeks.
    reply.raw.on('close', () => {
      try {
        fileStream.destroy();
      } catch {
        /* already closed */
      }
    });
    fileStream.pipe(reply.raw);
  });

  app.delete('/api/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = await registry.remove(id);
    if (!removed) return reply.code(404).send({ error: 'Stream not found or expired' });
    req.log.info({ id }, 'stream deleted');
    return reply.send({ deleted: true });
  });
}
