import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('startup configuration', () => {
  it('requires production Resend credentials and validates the sender without exposing the key', () => {
    const base = {
      NODE_ENV: 'production',
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
      PUBLIC_URL: 'https://example.com',
    };
    expect(() => loadConfig(base)).toThrow('RESEND_API_KEY');
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 're_secret' })).toThrow('EMAIL_FROM');
    expect(() =>
      loadConfig({ ...base, RESEND_API_KEY: 're_secret', EMAIL_FROM: 'bad sender' }),
    ).not.toThrow('re_secret');
    expect(
      loadConfig({
        ...base,
        RESEND_API_KEY: 're_secret',
        EMAIL_FROM: 'Helious <noreply@example.com>',
        EMAIL_REPLY_TO: 'help@example.com',
      }).EMAIL_REPLY_TO,
    ).toBe('help@example.com');
  });
  it('refuses a missing or malformed master key without logging its supplied value', () => {
    expect(() => loadConfig({})).toThrow('HELIOUS_MASTER_KEY');
    expect(() => loadConfig({ HELIOUS_MASTER_KEY: 'private-invalid-value' })).not.toThrow(
      'private-invalid-value',
    );
    expect(() => loadConfig({ HELIOUS_MASTER_KEY: 'private-invalid-value' })).toThrow('64 hex');
  });
  it('parses booleans explicitly instead of treating false as truthy', () => {
    const config = loadConfig({
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
      REGISTRATION_OPEN: 'false',
      COOKIE_SECURE: 'false',
    });
    expect(config.REGISTRATION_OPEN).toBe(false);
    expect(config.secureCookies).toBe(false);
  });
  it('rejects ambiguous origins and insecure public production configuration', () => {
    const base = {
      HELIOUS_MASTER_KEY: 'a'.repeat(64),
      NODE_ENV: 'production',
      RESEND_API_KEY: 're_test_placeholder',
      EMAIL_FROM: 'Helious <test@example.com>',
    };
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'https://example.com/path' })).toThrow('origin');
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'http://example.com' })).toThrow('HTTPS');
    expect(() =>
      loadConfig({ ...base, PUBLIC_URL: 'https://example.com', COOKIE_SECURE: 'false' }),
    ).toThrow('secure cookies');
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://example.com/' }).PUBLIC_URL).toBe(
      'https://example.com',
    );
  });
});
