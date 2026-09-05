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
  scanLocation: process.env.SCAN_LOCATION || 'Server region not configured',
  userAgent: process.env.USER_AGENT || ''
});
