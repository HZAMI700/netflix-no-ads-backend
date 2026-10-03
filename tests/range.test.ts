import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/streams/range.js';

describe('parseRange', () => {
  it('returns none when no header is sent', () => {
    expect(parseRange(undefined, 1000)).toBe('none');
  });

  it('parses an explicit range', () => {
    expect(parseRange('bytes=0-1023', 5000)).toEqual({ start: 0, end: 1023 });
  });

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=500-', 5000)).toEqual({ start: 500, end: 4999 });
  });

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-500', 5000)).toEqual({ start: 4500, end: 4999 });
  });

  it('clamps an end past the file size', () => {
    expect(parseRange('bytes=0-99999', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('rejects a start beyond EOF (416 territory)', () => {
    expect(parseRange('bytes=5000-6000', 5000)).toBeNull();
    expect(parseRange('bytes=5000-', 5000)).toBeNull();
  });

  it('rejects malformed headers', () => {
    expect(parseRange('bytes=abc-def', 1000)).toBeNull();
    expect(parseRange('items=0-10', 1000)).toBeNull();
    expect(parseRange('bytes=10-5', 1000)).toBeNull();
  });
});
