/**
 * Replaceable torrent-engine contract.
 * The Fastify layer only talks to this interface, so the WebTorrent
 * implementation can be swapped without touching routes or lifecycle code.
 */
import type { Readable } from 'node:stream';

export interface EngineTorrentFile {
  /** Index of the file inside the torrent. */
  index: number;
  name: string;
  length: number;
}

export interface EngineTorrent {
  infoHash: string;
  files: EngineTorrentFile[];
  /** Live swarm stats (best effort, may be 0 while metadata loads). */
  readonly numPeers: number;
  readonly progress: number;
  readonly downloadSpeed: number;
  /**
   * Progressive byte stream for a file. Never buffers the whole file:
   * resolves chunks as pieces arrive.
   */
  createReadStream(fileIndex: number, start: number, end?: number): Readable;
  /** Stops the session and deletes downloaded data. */
  destroy(): Promise<void>;
}

export interface AddOptions {
  /** Directory the engine may write temp data to (already unique per stream). */
  downloadPath: string;
  /** How long to wait for torrent metadata before giving up. */
  metadataTimeoutMs: number;
}

export interface TorrentEngine {
  /** Adds a magnet and resolves once metadata (file list) is available. */
  add(magnet: string, opts: AddOptions): Promise<EngineTorrent>;
  /** Destroys every session; called on server shutdown. */
  shutdown(): Promise<void>;
}
