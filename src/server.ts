/** Fastify app factory (no listen here — keeps routes unit-testable). */
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { registerStreamRoutes } from './streams/routes.js';
import type { StreamRegistry } from './streams/registry.js';
import type { TorrentEngine } from './torrent/types.js';

export interface AppDeps {
  config: AppConfig;
  engine: TorrentEngine;
  registry: StreamRegistry;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, engine, registry } = deps;
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true });

  // Browsers on your Vercel frontend must be allowed to call this API.
  void app.register(cors, { origin: config.frontendUrls, methods: ['GET', 'POST', 'DELETE'] });
  // Global abuse brake; the expensive POST route sets its own tighter budget.
  void app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    activeStreams: registry.count(),
  }));

  // Root route: some hosts probe `/` for liveness by default.
  app.get('/', async () => ({
    name: 'netflix-no-ads-backend',
    status: 'ok',
    health: '/health',
  }));

  registerStreamRoutes(app, { config, engine, registry });

  app.setNotFoundHandler(async (req, reply) => reply.code(404).send({ error: 'Not found' }));

  // Never leak stack traces or server paths to clients; log them instead.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const message = status >= 500 ? 'Internal server error' : err.message || 'Bad request';
    if (!reply.sent) void reply.code(status).send({ error: message });
  });

  return app;
}
