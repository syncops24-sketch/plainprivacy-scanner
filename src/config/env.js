function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

export const env = Object.freeze({
  port: int('PORT', 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: int('TRUST_PROXY', 0),
  scanTimeoutMs: int('SCAN_TIMEOUT_MS', 25_000),
  navigationTimeoutMs: int('NAVIGATION_TIMEOUT_MS', 12_000),
  maxRedirects: int('MAX_REDIRECTS', 5),
  maxRequests: int('MAX_REQUESTS', 250),
  maxMainDocumentBytes: int('MAX_MAIN_DOCUMENT_BYTES', 5_000_000),
  maxConcurrentScans: int('MAX_CONCURRENT_SCANS', 2),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60_000),
  rateLimitMax: int('RATE_LIMIT_MAX', 10),
  scanLocation: process.env.SCAN_LOCATION || 'Oregon, USA',
  webshareHost: process.env.WEBSHARE_HOST || '',
  websharePort: process.env.WEBSHARE_PORT || '',
  webshareUsernameDe: process.env.WEBSHARE_USERNAME_DE || '',
  webshareUsernameUsCa: process.env.WEBSHARE_USERNAME_US_CA || '',
  webshareUsernameUsVa: process.env.WEBSHARE_USERNAME_US_VA || '',
  webshareUsernameUsNy: process.env.WEBSHARE_USERNAME_US_NY || '',
  webshareUsernameCanada: process.env.WEBSHARE_USERNAME_CA_COUNTRY || '',
  webshareUsernameBr: process.env.WEBSHARE_USERNAME_BR || '',
  websharePassword: process.env.WEBSHARE_PASSWORD || '',
  userAgent: process.env.USER_AGENT || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://plainprivacy.org,https://www.plainprivacy.org')
    .split(',').map((value) => value.trim()).filter(Boolean)
});
