import type { Server } from 'node:http';
import type { Logger } from '../shared/logger/logger.js';

export type Closable = { close: () => Promise<void> };

/**
 * Graceful shutdown — Ch8 Resilience / SIGTERM handling.
 *
 * Kubernetes (and Docker Compose stop) send SIGTERM, then wait ~30s.
 * We: stop accepting connections → drain in-flight → close infra → exit.
 */
export function registerGracefulShutdown(opts: {
  server: Server;
  logger: Logger;
  resources: Closable[];
  stopWorkers?: Array<() => Promise<void>>;
  timeoutMs?: number;
}): void {
  let shuttingDown = false;
  const timeoutMs = opts.timeoutMs ?? 25_000;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    opts.logger.info({ signal }, 'Graceful shutdown started');

    const forceTimer = setTimeout(() => {
      opts.logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, timeoutMs);
    forceTimer.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        opts.server.close((err) => (err ? reject(err) : resolve()));
      });
      opts.logger.info('HTTP server stopped accepting connections');

      if (opts.stopWorkers) {
        for (const stop of opts.stopWorkers) {
          await stop();
        }
      }

      for (const resource of opts.resources) {
        await resource.close();
      }

      opts.logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      opts.logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
