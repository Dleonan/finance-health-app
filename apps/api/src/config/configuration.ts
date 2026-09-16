import type { ConfigService } from '@nestjs/config';

const alwaysRequired = ['DATABASE_URL', 'JWT_SECRET'];
const productionRequired = ['PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_SECRET', 'WEBHOOK_SHARED_SECRET'];

export function validateConfig(config: Record<string, unknown>) {
  const nodeEnv = String(config.NODE_ENV ?? 'development');
  const required =
    nodeEnv === 'production' ? [...alwaysRequired, ...productionRequired] : alwaysRequired;
  const missing = required.filter((key) => !String(config[key] ?? '').trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const numeric = [
    'PORT',
    'JWT_ACCESS_TTL_SECONDS',
    'REFRESH_TOKEN_TTL_DAYS',
    'SYNC_WORKER_INTERVAL_MS',
    'SYNC_MAX_ATTEMPTS',
    'SYNC_RETRY_BASE_MS',
    'SYNC_RETRY_MAX_MS',
  ];
  const invalidNumeric = numeric.filter((key) => {
    const value = config[key];
    return value !== undefined && (!Number.isFinite(Number(value)) || Number(value) <= 0);
  });
  if (invalidNumeric.length > 0) {
    throw new Error(`Invalid numeric environment variables: ${invalidNumeric.join(', ')}`);
  }

  return {
    ...config,
    NODE_ENV: nodeEnv,
    HOST: String(config.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
    PORT: Number(config.PORT ?? 3000),
    JWT_ACCESS_TTL_SECONDS: Number(config.JWT_ACCESS_TTL_SECONDS ?? 900),
    REFRESH_TOKEN_TTL_DAYS: Number(config.REFRESH_TOKEN_TTL_DAYS ?? 30),
    SYNC_WORKER_INTERVAL_MS: Number(config.SYNC_WORKER_INTERVAL_MS ?? 1_000),
    SYNC_MAX_ATTEMPTS: Number(config.SYNC_MAX_ATTEMPTS ?? 3),
    SYNC_RETRY_BASE_MS: Number(config.SYNC_RETRY_BASE_MS ?? 5_000),
    SYNC_RETRY_MAX_MS: Number(config.SYNC_RETRY_MAX_MS ?? 300_000),
  };
}

export function allowedCorsOrigins(config: ConfigService): string[] {
  return (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
