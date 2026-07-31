const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

// A real (non-dev) build that still resolves to localhost means
// EXPO_PUBLIC_API_URL was never set for that build profile (see mobile/
// eas.json's preview/production "env") — it would otherwise fail silently
// on a real device with no indication why every request is timing out.
if (!__DEV__ && API_URL.includes('localhost')) {
  console.warn(
    `[config] EXPO_PUBLIC_API_URL resolved to "${API_URL}" in a production build — this almost ` +
      'certainly means it was never set for this build profile. See mobile/eas.json.'
  );
}

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
