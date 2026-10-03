import { describe, expect, it } from 'vitest';
import { parseMagnet, sanitizeFilename, ValidationError } from '../src/torrent/validator.js';

const HEX_MAGNET =
  'magnet:?xt=urn:btih:08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b&dn=Sintel&tr=udp%3A%2F%2Ftracker.example%2Fannounce';
const BASE32_MAGNET = 'magnet:?xt=urn:btih:MF2GQZJANZSWK4TUMV3GKZRAMJVGW4T3Q&dn=Demo';

describe('parseMagnet', () => {
  it('accepts a 40-char hex info hash', () => {
    expect(parseMagnet(HEX_MAGNET)).toEqual({ infoHash: '08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b' });
  });

  it('accepts a 32-char base32 info hash', () => {
    expect(parseMagnet(BASE32_MAGNET).infoHash).toHaveLength(32);
  });

  it('rejects non-magnet strings', () => {
    expect(() => parseMagnet('https://example.com/file.torrent')).toThrow(ValidationError);
  });

  it('rejects magnets without an info hash', () => {
    expect(() => parseMagnet('magnet:?dn=noname')).toThrow(ValidationError);
  });

  it('rejects non-string input', () => {
    expect(() => parseMagnet({ xt: 'x' })).toThrow(ValidationError);
  });

  it('rejects oversized input', () => {
    expect(() => parseMagnet(`magnet:?xt=urn:btih:${'a'.repeat(5000)}`)).toThrow(ValidationError);
  });
});

describe('sanitizeFilename', () => {
  it('keeps innocent names intact', () => {
    expect(sanitizeFilename('Big Buck Bunny.mp4')).toBe('Big Buck Bunny.mp4');
  });

  it('strips directories and hostile characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('a"b<c>.mp4')).toBe('abc.mp4');
  });

  it('falls back for empty or invalid input', () => {
    expect(sanitizeFilename('')).toBe('video');
    expect(sanitizeFilename(undefined)).toBe('video');
  });
});
