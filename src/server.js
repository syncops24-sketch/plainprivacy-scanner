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
  crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(express.json({ limit: '8kb' }));
app.use(express.static('public', { extensions: ['html'], maxAge: env.nodeEnv === 'production' ? '1h' : 0 }));

const scanLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many scans from this address. Please try again later.' }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/scan', scanLimiter, async (req, res) => {
  if (!semaphore.tryAcquire()) {
    return res.status(503).json({ error: 'The scanner is currently at capacity. Please try again shortly.' });
  }

  try {
    const submitted = req.body?.url;
    const validated = await validatePublicUrl(submitted);
    const raw = await scanPage(validated.url.toString());
    const report = createReport(raw);
    return res.json(report);
  } catch (error) {
    if (error instanceof UnsafeUrlError) return res.status(400).json({ error: error.message });
    console.error('[scan-error]', error);
    const message = error?.message === 'SCAN_TIMEOUT'
      ? 'The site took too long to scan.'
      : 'The automated scan could not complete for this site. It may block automated browsers, load too slowly, or require manual verification.';
    return res.status(422).json({ error: message });
  } finally {
    semaphore.release();
  }
});

const server = app.listen(env.port, () => {
  console.log(`PlainPrivacy Scanner listening on http://localhost:${env.port}`);
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
