/**
 * Full HTTP-path test with a fake in-memory engine (no P2P traffic):
 * proves POST → GET (200/206/416) → INFO → DELETE → 404 over real Fastify routing.
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { StreamRegistry } from '../src/streams/registry.js';
import type { EngineTorrent, TorrentEngine } from '../src/torrent/types.js';

const PAYLOAD = Buffer.from('0123456789ABCDEF'.repeat(64)); // 1024 bytes

class FakeEngine implements TorrentEngine {
  readonly destroyed: string[] = [];
  readonly shutDown = { value: false };

  async add(): Promise<EngineTorrent> {
    const self = this;
    const id = `fake-${Math.random()}`;
    return {
      infoHash: 'abc123',
      files: [{ index: 0, name: 'demo.mp4', length: PAYLOAD.length }],
      numPeers: 7,
      progress: 0.5,
      downloadSpeed: 1024,
      createReadStream(_i: number, start: number, end?: number): Readable {
        return Readable.from([PAYLOAD.subarray(start, (end ?? PAYLOAD.length - 1) + 1)]);
      },
      async destroy(): Promise<void> {
        self.destroyed.push(id);
      },
    };
  }

  async shutdown(): Promise<void> {
    this.shutDown.value = true;
  }
}

const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b&dn=Demo';

function testConfig(): AppConfig {
  return {
    port: 0,
    publicBaseUrl: 'http://test',
    frontendUrls: ['http://test'],
    maxActiveStreams: 5,
    maxFileSizeBytes: 8 * 1024 ** 3,
    streamTtlMs: 60_000,
    tempDir: './data/test',
    ffmpegPath: '',
    transcodePreset: 'veryfast',
    metadataTimeoutMs: 5_000,
    logLevel: 'silent',
  };
}

describe('HTTP API (fake engine)', () => {
  it('POST → GET full → GET range → INFO → DELETE → gone', async () => {
    const config = testConfig();
    const engine = new FakeEngine();
    const destroyed: string[] = [];
    const registry = new StreamRegistry({
      maxActive: 5,
      ttlMs: 60_000,
      destroy: async (s) => {
        destroyed.push(s.id);
        await s.engineHandle.destroy();
      },
    });
    const app = buildApp({ config, engine, registry });

    const created = await app.inject({ method: 'POST', url: '/api/stream', payload: { magnet: MAGNET } });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string; streamUrl: string; mimeType: string; direct: boolean };
    expect(body.streamUrl).toBe(`http://test/api/stream/${body.id}`);
    expect(body.mimeType).toBe('video/mp4');
    expect(body.direct).toBe(true);

    const full = await app.inject({ method: 'GET', url: `/api/stream/${body.id}` });
    expect(full.statusCode).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.body).toBe(PAYLOAD.toString());

    const part = await app.inject({
      method: 'GET',
      url: `/api/stream/${body.id}`,
      headers: { range: 'bytes=0-99' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${PAYLOAD.length}`);
    expect(part.body).toBe(PAYLOAD.subarray(0, 100).toString());

    const badRange = await app.inject({
      method: 'GET',
      url: `/api/stream/${body.id}`,
      headers: { range: `bytes=${PAYLOAD.length}-` },
    });
    expect(badRange.statusCode).toBe(416);

    const info = await app.inject({ method: 'GET', url: `/api/stream/${body.id}/info` });
    expect(info.statusCode).toBe(200);
    expect(info.json()).toMatchObject({ fileName: 'demo.mp4', peers: 7 });

    const del = await app.inject({ method: 'DELETE', url: `/api/stream/${body.id}` });
    expect(del.statusCode).toBe(200);
    expect(destroyed).toEqual([body.id]);
    expect(engine.destroyed).toHaveLength(1);

    const gone = await app.inject({ method: 'GET', url: `/api/stream/${body.id}` });
    expect(gone.statusCode).toBe(404);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({ status: 'ok', activeStreams: 0 });

    await app.close();
  });

  it('rejects invalid magnets and enforces caps', async () => {
    const config = testConfig();
    const engine = new FakeEngine();
    const registry = new StreamRegistry({ maxActive: 0, ttlMs: 60_000, destroy: async () => undefined });
    const app = buildApp({ config, engine, registry });

    const bad = await app.inject({ method: 'POST', url: '/api/stream', payload: { magnet: 'nope' } });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({ method: 'POST', url: '/api/stream', payload: {} });
    expect(missing.statusCode).toBe(400);

    const capped = await app.inject({ method: 'POST', url: '/api/stream', payload: { magnet: MAGNET } });
    expect(capped.statusCode).toBe(429);

    await app.close();
  });
});
