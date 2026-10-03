/** Centralized, validated environment configuration. All secrets stay in env vars. */

export interface AppConfig {
  port: number;
  /** Public base URL used to build absolute streamUrl values returned to clients. */
  publicBaseUrl: string;
  /** Allowed browser origins for CORS (your Vercel frontend). */
  frontendUrls: string[];
  maxActiveStreams: number;
  maxFileSizeBytes: number;
  streamTtlMs: number;
  tempDir: string;
  ffmpegPath: string;
  transcodePreset: string;
  metadataTimeoutMs: number;
  logLevel: string;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: expected a positive integer`);
  return n;
}

function floatGb(name: string, fallbackGb: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallbackGb * 1024 ** 3;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}: expected a positive number of GB`);
  return Math.floor(n * 1024 ** 3);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const frontendRaw = env['FRONTEND_URL'] ?? 'http://localhost:8000';
  const frontendUrls = frontendRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (frontendUrls.length === 0) throw new Error('Invalid FRONTEND_URL: at least one origin is required');

  return {
    port: int('PORT', 4000),
    publicBaseUrl: (env['PUBLIC_BASE_URL'] ?? `http://localhost:${env['PORT'] ?? '4000'}`).replace(/\/$/, ''),
    frontendUrls,
    maxActiveStreams: int('MAX_ACTIVE_STREAMS', 5),
    maxFileSizeBytes: floatGb('MAX_FILE_SIZE_GB', 8),
    streamTtlMs: int('STREAM_EXPIRATION_MINUTES', 60) * 60_000,
    tempDir: env['TEMP_DIR'] ?? './data/torrents',
    ffmpegPath: env['FFMPEG_PATH'] ?? '',
    transcodePreset: env['TRANSCODE_PRESET'] ?? 'veryfast',
    metadataTimeoutMs: int('METADATA_TIMEOUT_SECONDS', 90) * 1000,
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}
