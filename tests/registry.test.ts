import { describe, expect, it, vi } from 'vitest';
import { StreamError, StreamRegistry, type StreamSession } from '../src/streams/registry.js';
import type { EngineTorrent } from '../src/torrent/types.js';

function fakeHandle(): EngineTorrent {
  return {
    infoHash: 'abc',
    files: [],
    numPeers: 0,
    progress: 0,
    downloadSpeed: 0,
    createReadStream: () => {
      throw new Error('not used in registry tests');
    },
    destroy: async () => undefined,
  };
}

function sessionData() {
  return {
    fileName: 'demo.mp4',
    fileSize: 1024,
    fileIndex: 0,
    mimeType: 'video/mp4',
    direct: true,
    engineHandle: fakeHandle(),
    downloadPath: '/tmp/x',
  };
}

describe('StreamRegistry', () => {
  it('creates sessions with unique ids and tracks count', () => {
    const r = new StreamRegistry({ maxActive: 2, ttlMs: 60_000, destroy: async () => undefined });
    const a = r.create(sessionData());
    const b = r.create(sessionData());
    expect(a.id).not.toBe(b.id);
    expect(r.count()).toBe(2);
  });

  it('enforces the active-stream cap', () => {
    const r = new StreamRegistry({ maxActive: 1, ttlMs: 60_000, destroy: async () => undefined });
    r.create(sessionData());
    expect(() => r.create(sessionData())).toThrow(StreamError);
  });

  it('throws 404 for unknown ids', () => {
    const r = new StreamRegistry({ maxActive: 1, ttlMs: 60_000, destroy: async () => undefined });
    expect(() => r.get('nope')).toThrow(StreamError);
  });

  it('removes sessions and calls destroy', async () => {
    const destroy = vi.fn(async (_s: StreamSession) => undefined);
    const r = new StreamRegistry({ maxActive: 2, ttlMs: 60_000, destroy });
    const s = r.create(sessionData());
    expect(await r.remove(s.id)).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(await r.remove(s.id)).toBe(false);
  });

  it('expires idle sessions via sweep but keeps active ones', async () => {
    let now = 1_000_000;
    const destroyed: string[] = [];
    const r = new StreamRegistry({
      maxActive: 5,
      ttlMs: 60_000,
      now: () => now,
      destroy: async (s) => {
        destroyed.push(s.id);
      },
    });
    const idle = r.create(sessionData());
    now += 30_000;
    const active = r.create(sessionData());
    now += 40_000; // idle is 70s old (expired), active is 40s old (kept)
    const expired = await r.sweep();
    expect(expired).toEqual([idle.id]);
    expect(destroyed).toEqual([idle.id]);
    expect(r.get(active.id).id).toBe(active.id);
  });

  it('touch refreshes the idle timer', async () => {
    let now = 1_000_000;
    const r = new StreamRegistry({ maxActive: 5, ttlMs: 60_000, now: () => now, destroy: async () => undefined });
    const s = r.create(sessionData());
    now += 50_000;
    r.touch(s.id);
    now += 50_000; // only 50s since touch → survives
    expect(await r.sweep()).toEqual([]);
  });

  it('shutdownAll destroys everything', async () => {
    const destroy = vi.fn(async (_s: StreamSession) => undefined);
    const r = new StreamRegistry({ maxActive: 5, ttlMs: 60_000, destroy });
    r.create(sessionData());
    r.create(sessionData());
    await r.shutdownAll();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(r.count()).toBe(0);
  });
});
