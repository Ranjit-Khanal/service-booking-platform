// SPDX-License-Identifier: AGPL-3.0-only
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_STATE_TRANSITION'
  | 'CONFLICT'
  | 'SLOT_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYMENT_FAILED'
  | 'EXTERNAL_TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    retryable?: boolean;
    details?: unknown;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ code: 'NOT_FOUND', message, statusCode: 404, details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ code: 'CONFLICT', message, statusCode: 409, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid API key') {
    super({ code: 'UNAUTHORIZED', message, statusCode: 401 });
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ code: 'INVALID_STATE_TRANSITION', message, statusCode: 409, details });
  }
}

export class SlotUnavailableError extends AppError {
  constructor(message = 'Selected slot is no longer available') {
    super({ code: 'SLOT_UNAVAILABLE', message, statusCode: 409, retryable: false });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ code: 'VALIDATION_ERROR', message, statusCode: 400, details });
  }
}

export class PaymentFailedError extends AppError {
  constructor(message: string, retryable = false) {
    super({ code: 'PAYMENT_FAILED', message, statusCode: 402, retryable });
  }
}

export class ExternalTimeoutError extends AppError {
  constructor(message: string) {
    super({ code: 'EXTERNAL_TIMEOUT', message, statusCode: 504, retryable: true });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super({ code: 'SERVICE_UNAVAILABLE', message, statusCode: 503, retryable: true });
  }
}
