/**
 * Stream lifecycle registry: unique IDs, activity tracking, expiry sweeps.
 * Engine-agnostic — destruction is injected, so this is unit-testable
 * without any torrent traffic.
 */
import { randomUUID } from 'node:crypto';
import type { EngineTorrent } from '../torrent/types.js';

export class StreamError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'StreamError';
  }
}

export interface StreamSession {
  id: string;
  /** Sanitized display name only — never a filesystem path. */
  fileName: string;
  fileSize: number;
  fileIndex: number;
  mimeType: string;
  /** False when the browser needs the FFmpeg transcode path. */
  direct: boolean;
  createdAt: number;
  lastAccessAt: number;
  engineHandle: EngineTorrent;
  /** Temp dir for this session's torrent data (server-side only). */
  downloadPath: string;
}

export interface RegistryOptions {
  maxActive: number;
  ttlMs: number;
  /** Clock injection for tests. */
  now?: () => number;
  /** Destroys the engine session + temp data. */
  destroy: (session: StreamSession) => Promise<void>;
}

export class StreamRegistry {
  private readonly sessions = new Map<string, StreamSession>();
  private readonly now: () => number;
  private readonly destroySession: (session: StreamSession) => Promise<void>;
  readonly maxActive: number;
  readonly ttlMs: number;

  constructor(opts: RegistryOptions) {
    this.maxActive = opts.maxActive;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
    this.destroySession = opts.destroy;
  }

  count(): number {
    return this.sessions.size;
  }

  create(data: Omit<StreamSession, 'id' | 'createdAt' | 'lastAccessAt'>): StreamSession {
    if (this.sessions.size >= this.maxActive) {
      throw new StreamError('Server is busy: too many active streams, try again later', 429);
    }
    const t = this.now();
    const session: StreamSession = { ...data, id: randomUUID(), createdAt: t, lastAccessAt: t };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): StreamSession {
    const session = this.sessions.get(id);
    if (!session) throw new StreamError('Stream not found or expired', 404);
    return session;
  }

  /** Refresh idle timer; call on every successful read. */
  touch(id: string): StreamSession {
    const session = this.get(id);
    session.lastAccessAt = this.now();
    return session;
  }

  /** Remove + destroy. Returns false when the id was unknown. */
  async remove(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    await this.destroySession(session);
    return true;
  }

  /** Remove every session idle longer than the TTL. Returns expired ids. */
  async sweep(): Promise<string[]> {
    const expired: string[] = [];
    for (const [id, session] of this.sessions) {
      if (this.now() - session.lastAccessAt >= this.ttlMs) {
        this.sessions.delete(id);
        try {
          await this.destroySession(session);
        } catch {
          /* cleanup must never crash the sweeper */
        }
        expired.push(id);
      }
    }
    return expired;
  }

  /** Destroy everything; used on graceful shutdown. */
  async shutdownAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(all.map((s) => this.destroySession(s)));
  }
}
