# Streaming Backend — torrent-to-HTTP API

Accepts a magnet link for content you are **authorized to distribute**, downloads/streams it
server-side, and exposes it to browsers as a normal HTTP stream with seeking — so the
frontend no longer depends on WebRTC browser peers.

> ⚖️ **Legal note:** operate this system only with content you are authorized to access
> and distribute. The operator is responsible for compliance with copyright law.

## How it works

```
Browser ──POST /api/stream {magnet}──▶ API ──▶ BitTorrent swarm (server-side)
Browser ◀── 201 {id, streamUrl} ────── API
Browser ──GET /api/stream/:id ────────▶ API ──▶ <video> progressive stream (206 ranges)
```

- MP4/WebM/MOV → piped straight through with full byte-range seeking, nothing held in RAM.
- MKV/AVI/others → FFmpeg transcodes to fragmented MP4 on the fly (seeking unavailable there).
- Sessions expire after idle TTL; temp data is deleted; shutdown is graceful.

## Installation

Requires Node.js 20+ and (for the transcode path) an `ffmpeg` binary.
The `ffmpeg-static` dependency bundles one automatically.

```bash
npm install
cp .env.example .env   # then edit values
```

## Local development

```bash
npm run dev     # tsx watch, reloads on change — http://localhost:4000
npm run test    # vitest suite
npm run typecheck
npm run build && npm start
```

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Listen port |
| `FRONTEND_URL` | `http://localhost:8000` | Allowed CORS origin(s), comma-separated — your Vercel URL in prod |
| `PUBLIC_BASE_URL` | `http://localhost:4000` | Base URL used to build absolute `streamUrl`s |
| `MAX_ACTIVE_STREAMS` | `5` | Cap on concurrent sessions (429 beyond) |
| `MAX_FILE_SIZE_GB` | `8` | Files larger than this are rejected (413) |
| `STREAM_EXPIRATION_MINUTES` | `60` | Idle TTL before a session + its temp data is deleted |
| `TEMP_DIR` | `./data/torrents` | Where torrent data lands |
| `FFMPEG_PATH` | _(bundled)_ | Override ffmpeg binary path |
| `TRANSCODE_PRESET` | `veryfast` | x264 preset for non-native containers |
| `METADATA_TIMEOUT_MS` | `90` | Seconds to wait for torrent metadata |
| `LOG_LEVEL` | `info` | pino level |

## Running with Docker

```bash
cp .env.example .env   # set FRONTEND_URL to your Vercel URL, PUBLIC_BASE_URL to the backend URL
docker compose up --build -d
docker compose logs -f api
```

## API usage

### `GET /health`

```bash
curl http://localhost:4000/health
# {"status":"ok","uptime":12.3,"activeStreams":0}
```

### `POST /api/stream` — start a session

```bash
curl -X POST http://localhost:4000/api/stream \
  -H 'Content-Type: application/json' \
  -d '{"magnet":"magnet:?xt=urn:btih:…","fileIndex":0}'
# 201 {"id":"…","streamUrl":"http://localhost:4000/api/stream/…",
#      "fileName":"…","fileSize":123,"mimeType":"video/mp4","direct":true}
```

`fileIndex` is optional — omit it to pick the largest file. `direct:false`
means the container needs transcoding (still playable, but no seeking).

### `GET /api/stream/:id` — play it

Drop `streamUrl` straight into a `<video>` tag; the browser handles ranges/seeking.
`HEAD`-style checks: `Accept-Ranges: bytes`, `206 Partial Content`, `416` for bad ranges.

### `GET /api/stream/:id/info` — metadata + live swarm stats

```bash
curl http://localhost:4000/api/stream/<id>/info
# {"id":"…","fileName":"…","fileSize":…,"mimeType":"video/mp4","direct":true,
#  "peers":12,"progress":0.34,"downloadSpeed":1048576}
```

### `DELETE /api/stream/:id` — stop + delete temp data

```bash
curl -X DELETE http://localhost:4000/api/stream/<id>
# {"deleted":true}
```

## Connecting the Vercel frontend

1. Deploy this backend anywhere long-lived (VPS, Render, Railway, Fly.io — **not**
   serverless: torrents need persistent processes and disk).
2. Set `FRONTEND_URL=https://your-app.vercel.app` and
   `PUBLIC_BASE_URL=https://your-api.example.com` in the backend env.
3. From the frontend:

```ts
// 1. Create a session from a magnet link
const res = await fetch('https://your-api.example.com/api/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ magnet, fileIndex: 0 }),
});
if (!res.ok) throw new Error(`stream failed: ${res.status}`);
const session: { id: string; streamUrl: string; direct: boolean } = await res.json();

// 2. Play it — the browser seeks natively for direct streams
videoElement.src = session.streamUrl;

// 3. Optional: poll swarm progress for your own progress bar
const info = await (await fetch(`https://your-api.example.com/api/stream/${session.id}/info`)).json();
console.log(info.peers, info.progress);

// 4. Release server resources when done
await fetch(`https://your-api.example.com/api/stream/${session.id}`, { method: 'DELETE' });
```

Plain-JS `fetch()` works identically — no SDK needed.

## Production deployment

- Put the API behind HTTPS (Caddy, Nginx, or platform TLS) and point
  `PUBLIC_BASE_URL` at the public URL.
- Restrict CORS via `FRONTEND_URL` (exact Vercel origin, no wildcards).
- Tune `MAX_ACTIVE_STREAMS` / `MAX_FILE_SIZE_GB` to your disk and bandwidth.
- Transcoding is CPU-heavy: size the box accordingly, or serve only MP4/WebM sources.
- Ship logs to your platform's log drain; request logging is built in (pino).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `502 Could not fetch torrent metadata` | Dead torrent or blocked BitTorrent traffic (some networks filter DHT/trackers). Try a known-good torrent; check egress firewall. |
| `429 Server is busy` | At the active-stream cap — raise `MAX_ACTIVE_STREAMS` or delete idle sessions. |
| Playback stalls at 0s | Swarm still fetching early pieces; check `/info` `progress`/`peers`. |
| No seeking on MKV | Expected: the transcode path serves `Accept-Ranges: none`. Use MP4 sources for seeking. |
| `ffmpeg` errors | Ensure a binary exists (`FFMPEG_PATH`, or apt install in Docker — already in the image). |

## Project structure

```
./
  src/
    index.ts                 entrypoint, graceful shutdown, expiry sweeper
    server.ts                Fastify app factory (CORS, rate limits, error mapping)
    config.ts                validated env config
    torrent/types.ts         engine interface (swap WebTorrent without touching routes)
    torrent/validator.ts     magnet + filename validation
    torrent/webtorrent-engine.ts  server-side torrent sessions
    streams/registry.ts      lifecycle: ids, caps, TTL, cleanup
    streams/range.ts         RFC byte-range parsing
    streams/routes.ts        the five endpoints
    media/content-type.ts    MIME + direct-play decisions
    media/ffmpeg.ts          no-shell FFmpeg transcode pipeline
  tests/                     vitest suite (validation, ranges, lifecycle, mime)
  Dockerfile / docker-compose.yml / .env.example
```
