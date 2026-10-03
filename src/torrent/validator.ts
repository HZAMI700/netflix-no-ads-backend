/** Input validation: magnets, file names. Never trust client input. */
import path from 'node:path';

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Accepts 40-char hex and 32-char base32 info hashes. */
const INFO_HASH_RE = /xt=urn:btih:([a-zA-Z0-9]{40}|[a-zA-Z2-7]{32})/i;

export function parseMagnet(magnet: unknown): { infoHash: string } {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:?')) {
    throw new ValidationError('Invalid magnet link: must start with "magnet:?"');
  }
  if (magnet.length > 4096) throw new ValidationError('Invalid magnet link: too long');
  const match = INFO_HASH_RE.exec(magnet);
  if (!match?.[1]) throw new ValidationError('Invalid magnet link: missing xt=urn:btih info hash');
  return { infoHash: match[1].toLowerCase() };
}

/**
 * Strips directories, control chars and anything hostile for
 * Content-Disposition headers. Never used to touch the filesystem.
 */
export function sanitizeFilename(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) return 'video';
  const base = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim();
  const clean = base.length > 120 ? base.slice(0, 120) : base;
  return clean.length > 0 ? clean : 'video';
}
