import { describe, expect, it } from 'vitest';
import { contentTypeFor, isDirectPlayable, mp4NameFor } from '../src/media/content-type.js';

describe('content-type helpers', () => {
  it('maps common extensions', () => {
    expect(contentTypeFor('movie.mp4')).toBe('video/mp4');
    expect(contentTypeFor('clip.WEBM')).toBe('video/webm');
    expect(contentTypeFor('film.mkv')).toBe('video/x-matroska');
  });

  it('falls back for unknown extensions', () => {
    expect(contentTypeFor('file.xyz')).toBe('application/octet-stream');
  });

  it('flags browser-native containers as direct', () => {
    expect(isDirectPlayable('a.mp4')).toBe(true);
    expect(isDirectPlayable('a.webm')).toBe(true);
    expect(isDirectPlayable('a.mkv')).toBe(false);
    expect(isDirectPlayable('a.avi')).toBe(false);
  });

  it('builds mp4 output names', () => {
    expect(mp4NameFor('film.mkv')).toBe('film.mp4');
    expect(mp4NameFor('noext')).toBe('noext.mp4');
  });
});
