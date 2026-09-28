// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from '../../../shared/logger/logger.js';
import type { RateLimiter } from '../../../domain/repositories/InfrastructurePorts.js';
import { AppError, NotFoundError, UnauthorizedError } from '../../../shared/errors/AppError.js';

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

function presentedKey(req: Request, header: string): string | undefined {
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  return req.header(header) ?? undefined;
}

function matchesAny(candidate: string | undefined, keys: string[]): boolean {
  if (!candidate) return false;
  const c = Buffer.from(candidate);
  // Compare against every key so timing doesn't reveal which one (or how many) matched.
  let ok = false;
  for (const key of keys) {
    const k = Buffer.from(key);
    if (k.length === c.length && timingSafeEqual(k, c)) ok = true;
  }
  return ok;
}

/**
 * Service-to-service auth: the integrating application holds an API key.
 * The booking service does not own end-user identity; the caller is trusted to
 * pass customer details (name, email) on behalf of its own authenticated users.
 */
export function apiKeyAuthMiddleware(opts: { mode: 'api_key' | 'none'; keys: string[] }) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (opts.mode === 'none') return next();
    if (matchesAny(presentedKey(req, 'x-api-key'), opts.keys)) return next();
    next(new UnauthorizedError());
  };
}

/** Admin routes are disabled (404) unless ADMIN_API_KEY is configured. */
export function adminAuthMiddleware(adminKey: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!adminKey) return next(new NotFoundError('Not found'));
    if (matchesAny(req.header('x-admin-key') ?? undefined, [adminKey])) return next();
    next(new UnauthorizedError('Missing or invalid admin key'));
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  opts: { windowMs: number; max: number; logger: Logger },
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // With `trust proxy` configured this is the client address from X-Forwarded-For.
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
      // Reads fail open so catalog/booking lookups survive a Redis outage;
      // mutations fail closed (they also need Redis for idempotency anyway).
      if (SAFE_METHODS.has(req.method)) {
        opts.logger.warn({ err: error }, 'Rate limiter unavailable; allowing read request');
        next();
        return;
      }
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
