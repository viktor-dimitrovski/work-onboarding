import { TokenResponse } from '@/lib/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
const STORAGE_KEY = 'onboarding_auth_v1';
const AUTH_UPDATED_EVENT = 'onboarding:auth-updated';

export class AuthExpiredError extends Error {
  constructor(message = 'Session expired. Please sign in again.') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

export function isAuthExpiredError(error: unknown): error is AuthExpiredError {
  return error instanceof AuthExpiredError;
}

interface RequestOptions extends RequestInit {
  token?: string | null;
}

function readStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { refreshToken?: string };
    return parsed?.refreshToken || null;
  } catch {
    return null;
  }
}

function writeStoredAuth(tokenResponse: TokenResponse): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        user: tokenResponse.user,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
      }),
    );
    window.dispatchEvent(new Event(AUTH_UPDATED_EVENT));
  } catch {
    // ignore storage failures (private mode, quota); request will still return data
  }
}

function clearStoredAuth(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(AUTH_UPDATED_EVENT));
  } catch {
    // ignore
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/refresh') || path.startsWith('/auth/logout');
  if (response.status === 401 && !isAuthEndpoint) {
    const refreshToken = readStoredRefreshToken();
    if (refreshToken) {
      try {
        const refreshed = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });

        if (refreshed.ok) {
          const tokenResponse = (await refreshed.json()) as TokenResponse;
          writeStoredAuth(tokenResponse);

          const retryHeaders = new Headers(options.headers || {});
          retryHeaders.set('Content-Type', 'application/json');
          retryHeaders.set('Authorization', `Bearer ${tokenResponse.access_token}`);

          const retryResponse = await fetch(url, {
            ...options,
            headers: retryHeaders,
          });

          if (!retryResponse.ok) {
            const maybeJson = await retryResponse.text();
            if (retryResponse.status === 401) {
              clearStoredAuth();
              throw new AuthExpiredError();
            }
            throw new Error(maybeJson || `Request failed with status ${retryResponse.status}`);
          }

          if (retryResponse.status === 204) {
            return {} as T;
          }

          return retryResponse.json() as Promise<T>;
        }
      } catch {
        // fall through to logout handling below
      }
    }
    clearStoredAuth();
    throw new AuthExpiredError();
  }

  if (!response.ok) {
    const maybeJson = await response.text();
    throw new Error(maybeJson || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  login(email: string, password: string) {
    return request<TokenResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  refresh(refreshToken: string) {
    return request<TokenResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  logout(refreshToken: string) {
    return request<void>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  me(token: string) {
    return request('/auth/me', { token });
  },

  get<T>(path: string, token: string) {
    return request<T>(path, { token });
  },

  post<T>(path: string, body: unknown, token: string) {
    return request<T>(path, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    });
  },

  put<T>(path: string, body: unknown, token: string) {
    return request<T>(path, {
      method: 'PUT',
      token,
      body: JSON.stringify(body),
    });
  },

  delete<T>(path: string, token: string) {
    return request<T>(path, {
      method: 'DELETE',
      token,
    });
  },
};
