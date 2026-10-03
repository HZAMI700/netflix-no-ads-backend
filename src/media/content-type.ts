/** Media-type helpers: correct Content-Type + direct-playability decisions. */
import path from 'node:path';

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
};

/** Containers browsers can play natively in a <video> tag. */
const DIRECT_PLAYABLE = new Set(['.mp4', '.m4v', '.mov', '.webm']);

export function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** True when the file can be piped straight to the browser. Otherwise FFmpeg transcodes. */
export function isDirectPlayable(filename: string): boolean {
  return DIRECT_PLAYABLE.has(path.extname(filename).toLowerCase());
}

/** Output name advertised for transcoded sessions (always a real .mp4). */
export function mp4NameFor(filename: string): string {
  const base = path.basename(filename).replace(/\.[a-z0-9]{2,4}$/i, '');
  return `${base || 'video'}.mp4`;
}
