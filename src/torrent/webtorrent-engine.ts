/** WebTorrent-backed implementation of the TorrentEngine contract. */
import type { Readable } from 'node:stream';
import type { AddOptions, EngineTorrent, EngineTorrentFile, TorrentEngine } from './types.js';

type WebTorrentCtor = new (opts?: Record<string, unknown>) => WebTorrentClient;
interface WebTorrentClient {
  add(magnet: string, opts: { path: string }, cb: (t: WebTorrentTorrent) => void): WebTorrentTorrent;
  destroy(cb?: (err?: Error) => void): void;
}
interface WebTorrentTorrent {
  infoHash: string;
  files: Array<{ name: string; length: number; createReadStream(opts?: { start?: number; end?: number }): Readable }>;
  numPeers: number;
  progress: number;
  downloadSpeed: number;
  on(event: 'ready' | 'error', cb: (arg?: unknown) => void): void;
  destroy(opts: { destroyStore: boolean }, cb?: (err?: Error) => void): void;
}

async function loadWebTorrent(): Promise<WebTorrentCtor> {
  // Dynamic import keeps startup fast and tolerates CJS/ESM packaging differences.
  const mod = (await import('webtorrent')) as unknown as {
    default?: WebTorrentCtor;
    WebTorrent?: WebTorrentCtor;
  };
  const Ctor = mod.default ?? mod.WebTorrent;
  if (!Ctor) throw new Error('webtorrent module did not export a client constructor');
  return Ctor;
}

class WebTorrentHandle implements EngineTorrent {
  constructor(
    private readonly torrent: WebTorrentTorrent,
    private readonly client: WebTorrentClient,
  ) {}

  get infoHash(): string {
    return this.torrent.infoHash;
  }

  get files(): EngineTorrentFile[] {
    return this.torrent.files.map((f, i) => ({ index: i, name: f.name, length: f.length }));
  }

  get numPeers(): number {
    return this.torrent.numPeers;
  }

  get progress(): number {
    return this.torrent.progress;
  }

  get downloadSpeed(): number {
    return this.torrent.downloadSpeed;
  }

  createReadStream(fileIndex: number, start: number, end?: number): Readable {
    const file = this.torrent.files[fileIndex];
    if (!file) throw new Error(`File index ${fileIndex} out of range`);
    return file.createReadStream(end === undefined ? { start } : { start, end });
  }

  async destroy(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.torrent.destroy({ destroyStore: true }, () => resolve());
    });
  }
}

export class WebTorrentEngine implements TorrentEngine {
  private clientPromise: Promise<WebTorrentClient> | null = null;

  private async client(): Promise<WebTorrentClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadWebTorrent().then((Ctor) => new Ctor({}));
    }
    return this.clientPromise;
  }

  async add(magnet: string, opts: AddOptions): Promise<EngineTorrent> {
    const client = await this.client();
    return new Promise<EngineTorrent>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          torrent.destroy({ destroyStore: true });
        } catch {
          /* best effort */
        }
        reject(new Error('Timed out waiting for torrent metadata'));
      }, opts.metadataTimeoutMs);

      const torrent = client.add(magnet, { path: opts.downloadPath }, (t) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new WebTorrentHandle(t, client));
      });
      torrent.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error('Torrent error'));
      });
    });
  }

  async shutdown(): Promise<void> {
    if (!this.clientPromise) return;
    const client = await this.clientPromise;
    await new Promise<void>((resolve) => client.destroy(() => resolve()));
    this.clientPromise = null;
  }
}
