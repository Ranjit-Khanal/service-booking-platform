import pino from 'pino';
import type { Env } from '../../config/env.js';

export type Logger = pino.Logger;

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV' | 'INSTANCE_ID'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: 'slotbook-api',
      instanceId: env.INSTANCE_ID,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino/file',
            options: { destination: 1 },
          },
        }
      : {}),
  });
}

export function childLogger(logger: Logger, bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
