import { z } from 'zod';
import { KeyRing, parsePreviousKeys } from './encryption.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGO_URI: z
    .string()
    .startsWith('mongodb')
    .default('mongodb://127.0.0.1:27017/helious?replicaSet=rs0'),
  HELIOUS_MASTER_KEY: z
    .string()
    .regex(
      /^[a-fA-F0-9]{64}$/,
      'HELIOUS_MASTER_KEY must be 32 random bytes encoded as 64 hex characters',
    ),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  HELIOUS_MASTER_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .default('v1'),
  HELIOUS_PREVIOUS_MASTER_KEYS: z.string().max(2048).default(''),
  COOKIE_SECURE: booleanString.optional(),
  REGISTRATION_OPEN: booleanString.default(true),
  REGISTRATION_MIN_AGE: z.coerce
    .number()
    .refine((value) => value === 0 || value === 18)
    .default(18),
  TERMS_VERSION: z.string().trim().max(80).default(''),
  TERMS_URL: z.string().trim().max(2048).default(''),
  PRIVACY_URL: z.string().trim().max(2048).default(''),
  ACCOUNT_EXPORT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1048576)
    .max(10737418240)
    .default(1073741824),
  TRUST_PROXY: z.string().default(''),
  RESEND_API_KEY: z.string().trim().default(''),
  EMAIL_FROM: z.string().trim().default('Helious <onboarding@resend.dev>'),
  EMAIL_REPLY_TO: z.union([z.email(), z.literal('')]).optional(),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    // Report field names and validation messages only; never print supplied environment values.
    throw new Error(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  const config = result.data;
  for (const name of ['TERMS_URL', 'PRIVACY_URL'] as const) {
    const value = config[name];
    if (!value) continue;
    const url = new URL(value, config.PUBLIC_URL);
    if (
      (!value.startsWith('/') && url.protocol !== 'https:') ||
      (value.startsWith('/') && url.origin !== new URL(config.PUBLIC_URL).origin) ||
      value.startsWith('//') ||
      [...value].some((character) => character.charCodeAt(0) < 32) ||
      url.username ||
      url.password
    )
      throw new Error(`${name} must be an HTTPS URL or a same-origin path`);
  }
  if (config.TERMS_VERSION && (!config.TERMS_URL || !config.PRIVACY_URL))
    throw new Error(
      'TERMS_VERSION requires TERMS_URL and PRIVACY_URL for the actual instance policies',
    );
  const previousMasterKeys = parsePreviousKeys(config.HELIOUS_PREVIOUS_MASTER_KEYS);
  new KeyRing(config.HELIOUS_MASTER_KEY_ID, config.HELIOUS_MASTER_KEY, previousMasterKeys);
  if (config.NODE_ENV === 'production' && !config.RESEND_API_KEY)
    throw new Error('RESEND_API_KEY is required in production');
  if (
    (config.RESEND_API_KEY || config.NODE_ENV === 'production') &&
    !environment.EMAIL_FROM?.trim()
  )
    throw new Error('EMAIL_FROM must use your verified Resend sender domain');
  if (!/^(?:[^<>\r\n]+\s<)?[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>?$/.test(config.EMAIL_FROM))
    throw new Error('EMAIL_FROM must be a valid sender address, optionally with a display name');
  const url = new URL(config.PUBLIC_URL);
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    throw new Error(
      'PUBLIC_URL must be an HTTP(S) origin without credentials, path, query, or fragment',
    );
  }
  const secure = config.COOKIE_SECURE ?? config.NODE_ENV === 'production';
  if (url.protocol === 'https:' && !secure)
    throw new Error('HTTPS deployments require secure cookies');
  if (
    url.protocol === 'http:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    config.NODE_ENV === 'production'
  ) {
    throw new Error('Public production deployments require HTTPS');
  }
  return { ...config, previousMasterKeys, PUBLIC_URL: url.origin, secureCookies: secure };
}

export type Config = ReturnType<typeof loadConfig>;
