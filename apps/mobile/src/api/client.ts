import * as SecureStore from 'expo-secure-store';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
const REFRESH_TOKEN_KEY = 'finance-health.refresh-token';
const REQUEST_TIMEOUT_MS = 15_000;
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

type AuthResponse = { accessToken: string; refreshToken: string };

export type ApiErrorCode =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'session_expired'
  | 'unauthorized'
  | 'validation'
  | 'conflict'
  | 'not_found'
  | 'rate_limited'
  | 'server';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}/v1${path}`, {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('timeout', 'A API demorou para responder. Tente novamente.');
    }
    throw new ApiError('network', 'Não foi possível alcançar a API. Verifique sua conexão.');
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 && retry && (await getStoredRefreshToken())) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);
    throw new ApiError('session_expired', 'Sua sessão expirou. Entre novamente.', 401);
  }
  if (!response.ok) throw errorForStatus(response.status);
  return response.json() as Promise<T>;
}

function getApiUrl() {
  if (!API_URL) {
    throw new ApiError(
      'configuration',
      'A URL da API não foi configurada. Defina EXPO_PUBLIC_API_URL para continuar.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(API_URL);
  } catch {
    throw new ApiError('configuration', 'A URL da API configurada é inválida.');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new ApiError(
      'configuration',
      'Use o IP LAN do computador ou uma URL HTTPS; localhost não funciona no iPhone.',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError('configuration', 'A API deve usar HTTP ou HTTPS.');
  }
  return API_URL;
}

function errorForStatus(status: number) {
  if (status === 400 || status === 422)
    return new ApiError('validation', 'Confira os dados informados.', status);
  if (status === 401) return new ApiError('unauthorized', 'Não autorizado.', status);
  if (status === 404) return new ApiError('not_found', 'Recurso não encontrado.', status);
  if (status === 409) return new ApiError('conflict', 'Este recurso já está vinculado.', status);
  if (status === 429)
    return new ApiError(
      'rate_limited',
      'Muitas tentativas. Aguarde um pouco e tente novamente.',
      status,
    );
  if (status >= 500) {
    return new ApiError('server', 'A API está temporariamente indisponível.', status);
  }
  return new ApiError('server', 'Não foi possível concluir a operação.', status);
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export async function register(email: string, password: string, displayName?: string) {
  return saveAuth(
    await request<AuthResponse>(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName, deviceName: 'mobile' }),
      },
      false,
    ),
  );
}

export async function login(email: string, password: string) {
  return saveAuth(
    await request<AuthResponse>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password, deviceName: 'mobile' }) },
      false,
    ),
  );
}

export async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await getStoredRefreshToken();
    if (!refreshToken) return null;
    try {
      const response = await request<AuthResponse>(
        '/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken }) },
        false,
      );
      await saveAuth(response);
      return response.accessToken;
    } catch {
      await clearAuth();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' }, false);
  } finally {
    await clearAuth();
  }
}

export function getAccessToken() {
  return accessToken;
}

export async function getStoredRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

async function saveAuth(response: AuthResponse) {
  accessToken = response.accessToken;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, response.refreshToken);
  return response;
}

async function clearAuth() {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
