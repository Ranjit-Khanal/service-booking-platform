export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8080';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function newRequestId(): string {
  return crypto.randomUUID();
}

export type ApiFetchOptions = RequestInit & {
  idempotencyKey?: string;
};

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { idempotencyKey, headers: initHeaders, ...rest } = options;
  const headers = new Headers(initHeaders);

  headers.set('x-request-id', newRequestId());
  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }
  if (rest.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(url, { ...rest, headers });

  const contentType = response.headers.get('content-type') ?? '';
  let body: unknown = null;
  if (response.status !== 204) {
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      const text = await response.text();
      body = text.length ? text : null;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof (body as { message: unknown }).message === 'string'
        ? (body as { message: string }).message
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, body);
  }

  return body as T;
}

/** Unwrap common `{ data: T }` or `{ services: T }` envelope shapes. */
export function unwrapList<T>(payload: unknown, keys: string[] = ['data', 'items', 'services', 'slots', 'bookings']): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value as T[];
      }
    }
  }
  return [];
}

export function unwrapEntity<T>(payload: unknown, keys: string[] = ['data', 'service', 'booking']): T {
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (value && typeof value === 'object') {
        return value as T;
      }
    }
  }
  return payload as T;
}
