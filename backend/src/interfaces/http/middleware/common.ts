import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '../../../shared/logger/logger.js';
import type { RateLimiter } from '../../../domain/repositories/InfrastructurePorts.js';
import { AppError } from '../../../shared/errors/AppError.js';

export function requestContextMiddleware(baseLogger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = String(req.header('x-request-id') ?? randomUUID());
    const correlationId = String(req.header('x-correlation-id') ?? requestId);
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-correlation-id', correlationId);

    const logger = baseLogger.child({ requestId, correlationId, path: req.path, method: req.method });
    (req as Request & { requestId: string; correlationId: string; log: Logger }).requestId =
      requestId;
    (req as Request & { correlationId: string }).correlationId = correlationId;
    (req as Request & { log: Logger }).log = logger;

    const started = Date.now();
    res.on('finish', () => {
      logger.info(
        { statusCode: res.statusCode, durationMs: Date.now() - started },
        'request completed',
      );
    });
    next();
  };
}

export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  opts: { windowMs: number; max: number },
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = req.ip ?? 'unknown';
      const result = await rateLimiter.consume(key, opts.max, opts.windowMs);
      res.setHeader('X-RateLimit-Limit', String(opts.max));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(result.resetMs));
      if (!result.allowed) {
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        });
        return;
      }
      next();
    } catch (error) {
      // Fail open on Redis outage for reads? We fail closed for safety on booking paths.
      next(error);
    }
  };
}

export function errorMiddleware(logger: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const correlationId =
      (req as Request & { correlationId?: string }).correlationId ?? 'unknown';

    if (err instanceof AppError) {
      logger.warn(
        { err, correlationId, code: err.code, statusCode: err.statusCode },
        err.message,
      );
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          correlationId,
          retryable: err.retryable,
        },
      });
      return;
    }

    logger.error({ err, correlationId }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        correlationId,
      },
    });
  };
}

export type AuthedRequest = Request & {
  requestId: string;
  correlationId: string;
  log: Logger;
};
