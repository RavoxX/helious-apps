export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  emailVerified: boolean;
  totpEnabled: boolean;
  pendingEmail?: string;
}
export interface Session {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// Keep CSRF credentials in memory, never browser localStorage.
let csrf: string | undefined;
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (method !== 'GET') {
    if (!csrf) {
      const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!response.ok)
        throw new ApiError(response.status, 'Unable to establish a secure connection. Try again.');
      csrf = ((await response.json()) as { csrfToken: string }).csrfToken;
    }
    if (!multipart) headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = csrf;
  }
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body:
      method !== 'GET' ? (multipart ? (body as FormData) : JSON.stringify(body ?? {})) : undefined,
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 403) csrf = undefined;
    const message =
      typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Unable to complete this request.';
    throw new ApiError(
      response.status,
      message,
      typeof data === 'object' && data && 'code' in data && typeof data.code === 'string'
        ? data.code
        : undefined,
    );
  }
  return data as T;
}
