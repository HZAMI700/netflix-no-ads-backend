/**
 * FFmpeg remux/transcode pipeline for containers browsers cannot play (MKV, AVI…).
 * fluent-ffmpeg spawns the binary with an argument array (no shell), so user
 * input can never become a shell command. Output is fragmented MP4, which
 * starts playing before the transcode finishes.
 */
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';

export interface TranscodeOptions {
  preset: string;
}

let configuredPath: string | null = null;

/** Prefer FFMPEG_PATH env (Docker), else the bundled ffmpeg-static binary. */
export function configureFfmpeg(envPath: string): string {
  const resolved = envPath.trim() || (ffmpegStatic as unknown as string);
  if (!resolved) throw new Error('No FFmpeg binary available: set FFMPEG_PATH or install ffmpeg');
  if (configuredPath !== resolved) {
    ffmpeg.setFfmpegPath(resolved);
    configuredPath = resolved;
  }
  return resolved;
}

export interface TranscodeJob {
  /** Fragmented-MP4 byte stream to pipe to the HTTP response. */
  stream: PassThrough;
  /** Stop FFmpeg and clean up (call when the client disconnects). */
  kill(): void;
}

export function transcodeToMp4(input: Readable, opts: TranscodeOptions): TranscodeJob {
  const out = new PassThrough();
  const command = ffmpeg(input)
    // No inputFormat: FFmpeg auto-detects the container (mkv, avi, …).
    .videoCodec('libx264')
    .addOption('-preset', opts.preset)
    .addOption('-crf', '23')
    .audioCodec('aac')
    .addOption('-movflags', 'frag_keyframe+empty_moov+default_base_moof')
    .format('mp4')
    .on('error', () => {
      // Client sees a truncated stream; destroy so the socket closes cleanly.
      out.destroy();
    });
  input.on('error', () => {
    try {
      command.kill('SIGKILL');
    } catch {
      /* already dead */
    }
    out.destroy();
  });
  command.pipe(out, { end: true });
  return {
    stream: out,
    kill() {
      try {
        command.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      out.destroy();
    },
  };
}
