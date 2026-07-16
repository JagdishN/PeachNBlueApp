const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

let authToken: string | null = null;

// Called by AuthContext whenever the token changes (sign in/out/restore) —
// keeps this module decoupled from React state.
export const setAuthToken = (token: string | null): void => {
  authToken = token;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

export const apiRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => undefined);

  if (!response.ok) {
    const message = (data as { error?: string } | undefined)?.error ?? 'Request failed';
    throw new ApiError(response.status, message);
  }

  return data as T;
};
