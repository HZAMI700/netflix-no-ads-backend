/** HTTP byte-range parsing (RFC 9110 §14). Inclusive start/end offsets. */

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * @returns the range to serve, `'none'` when the client sent no Range header,
 * or `null` when the range is unsatisfiable (caller must answer 416).
 */
export function parseRange(header: string | undefined, total: number): ByteRange | 'none' | null {
  if (!header) return 'none';
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;

  // Suffix range: last N bytes.
  if (startRaw === '') {
    const suffix = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    if (total === 0) return null;
    const len = Math.min(suffix, total);
    return { start: total - len, end: total - 1 };
  }

  const start = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(start) || start < 0 || start >= total) return null;
  if (endRaw === '') return { start, end: total - 1 };
  const end = Number.parseInt(endRaw, 10);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end: Math.min(end, total - 1) };
}
