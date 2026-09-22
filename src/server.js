import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { Semaphore } from './security/semaphore.js';
import { UnsafeUrlError, validatePublicUrl } from './security/urlValidator.js';
import { scanPage, closeBrowser } from './scanner/browserScanner.js';
import { createReport } from './report/report.js';

const app = express();
const semaphore = new Semaphore(env.maxConcurrentScans);
const SCANNER_VERSION = '1.1.2';

function logScanEvent(payload) {
  console.log(JSON.stringify({
    source: 'plainprivacy-scanner',
    scannerVersion: SCANNER_VERSION,
    timestamp: new Date().toISOString(),
    ...payload
  }));
}


function cleanText(value, max = 120) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
  return cleaned || null;
}

function cleanPath(value) {
  const cleaned = cleanText(value, 180);
  if (!cleaned || !cleaned.startsWith('/')) return '/';
  return cleaned.split('?')[0].split('#')[0] || '/';
}

function cleanHostname(value) {
  const cleaned = cleanText(value, 253)?.toLowerCase();
  if (!cleaned || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

if (env.trustProxy > 0) app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'sha256-JIPs2IJ4BieJdSwsa1wbaR9p8Lnw/aYj8TtA2S3F9R4='"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
const allowedOrigins = new Set(env.allowedOrigins);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '8kb' }));
app.use(express.static('public', { extensions: ['html'], maxAge: env.nodeEnv === 'production' ? '1h' : 0 }));

const scanLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many scans from this address. Please try again later.' }
});


const telemetryLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 240,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many telemetry events.' }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));


app.post('/api/visit', telemetryLimiter, (req, res) => {
  const page = cleanPath(req.body?.page);
  const referrerHost = cleanHostname(req.body?.referrerHost) || 'direct_or_unknown';
  const utmSource = cleanText(req.body?.utmSource, 80);
  const utmMedium = cleanText(req.body?.utmMedium, 80);
  const utmCampaign = cleanText(req.body?.utmCampaign, 120);
  const referral = cleanText(req.body?.ref, 80);

  logScanEvent({
    event: 'site_page_view',
    page,
    referrerHost,
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
    ...(referral ? { ref: referral } : {})
  });

  return res.status(204).end();
});

app.post('/api/scan', scanLimiter, async (req, res) => {
  if (!semaphore.tryAcquire()) {
    return res.status(503).json({ error: 'The scanner is currently at capacity. Please try again shortly.' });
  }

  const startedAt = Date.now();
  let hostname = null;

  try {
    const submitted = req.body?.url;
    const validated = await validatePublicUrl(submitted);
    hostname = validated.url.hostname.toLowerCase();

    logScanEvent({ event: 'scanner_started', hostname });

    const raw = await scanPage(validated.url.toString());
    const report = createReport(raw);

    logScanEvent({
      event: 'scanner_completed',
      hostname,
      durationMs: Date.now() - startedAt,
      score: report.score ?? null,
      concerns: report.summary?.concerns ?? null
    });

    return res.json(report);
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      logScanEvent({
        event: 'scanner_rejected',
        durationMs: Date.now() - startedAt,
        reason: 'unsafe_or_invalid_url'
      });
      return res.status(400).json({ error: error.message });
    }

    const reason = error?.message === 'SCAN_TIMEOUT' ? 'timeout' : 'scan_failed';
    const errorName = cleanText(error?.name || 'Error', 80) || 'Error';
    const errorMessage = cleanText(error?.message || 'Unknown scanner error', 500) || 'Unknown scanner error';

    logScanEvent({
      event: 'scanner_failed',
      ...(hostname ? { hostname } : {}),
      durationMs: Date.now() - startedAt,
      reason,
      errorName,
      errorMessage
    });

    const message = error?.message === 'SCAN_TIMEOUT'
      ? 'The site took too long to scan.'
      : 'The automated scan could not complete for this site. It may block automated browsers, load too slowly, or require manual verification.';
    return res.status(422).json({ error: message });
  } finally {
    semaphore.release();
  }
});

const server = app.listen(env.port, () => {
  console.log(`PlainPrivacy Scanner listening on port ${env.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    await closeBrowser();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
