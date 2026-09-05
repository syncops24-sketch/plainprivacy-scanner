import { chromium } from 'playwright';
import { env } from '../config/env.js';
import { assertSafeRequestUrl, validatePublicUrl, UnsafeUrlError } from '../security/urlValidator.js';
import { isThirdParty } from '../utils/domain.js';
import { inspectDom } from '../detectors/dom.js';

let browserPromise;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync'
      ]
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close().catch(() => {});
    browserPromise = null;
  }
}

export async function scanPage(inputUrl) {
  const initial = await validatePublicUrl(inputUrl);
  const browser = await getBrowser();
  const context = await browser.newContext({
    ...(env.userAgent ? { userAgent: env.userAgent } : {}),
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block'
  });

  const page = await context.newPage();
  page.setDefaultTimeout(4_000);
  page.setDefaultNavigationTimeout(env.navigationTimeoutMs);

  const network = [];
  const blocked = [];
  const scripts = new Set();
  let requestCount = 0;
  let mainDocumentTooLarge = false;

  await page.route('**/*', async (route) => {
    const request = route.request();
    requestCount += 1;
    if (requestCount > env.maxRequests) {
      blocked.push({ url: request.url(), reason: 'request-limit' });
      return route.abort('blockedbyclient');
    }

    if (['media', 'font', 'image'].includes(request.resourceType())) {
      return route.abort('blockedbyclient');
    }

    try {
      await assertSafeRequestUrl(request.url());
      return route.continue();
    } catch (error) {
      blocked.push({ url: request.url(), reason: error instanceof UnsafeUrlError ? 'unsafe-destination' : 'validation-error' });
      return route.abort('blockedbyclient');
    }
  });

  page.on('request', (request) => {
    const url = request.url();
    network.push({ url, method: request.method(), type: request.resourceType(), postDataPreview: String(request.postData() || '').slice(0, 1000) });
    if (request.resourceType() === 'script') scripts.add(url);
  });

  page.on('response', async (response) => {
    try {
      const request = response.request();
      if (request.resourceType() === 'document' && request.isNavigationRequest()) {
        const length = Number(response.headers()['content-length'] || 0);
        if (length > env.maxMainDocumentBytes) {
          mainDocumentTooLarge = true;
          await page.close().catch(() => {});
        }
      }
    } catch {}
  });

  const scanAbort = new AbortController();
  const scanTimer = setTimeout(() => scanAbort.abort(), env.scanTimeoutMs);

  try {
    const navPromise = page.goto(initial.url.toString(), { waitUntil: 'domcontentloaded', timeout: env.navigationTimeoutMs });
    const abortPromise = new Promise((_, reject) => scanAbort.signal.addEventListener('abort', () => reject(new Error('SCAN_TIMEOUT')), { once: true }));
    const response = await Promise.race([navPromise, abortPromise]);
    if (!response) throw new Error('No response received from the target site.');

    const chain = [];
    let req = response.request();
    while (req) {
      chain.unshift(req.url());
      req = req.redirectedFrom();
    }
    if (chain.length - 1 > env.maxRedirects) throw new Error('Too many redirects.');
    for (const url of chain) await validatePublicUrl(url);

    if (mainDocumentTooLarge) throw new Error('Main document exceeds the configured size limit.');

    // Give client-rendered banners/tags a brief deterministic window to initialize.
    await page.waitForTimeout(1800).catch(() => {});

    const finalUrl = page.url();
    const final = await validatePublicUrl(finalUrl);
    const dom = await inspectDom(page);
    const cookies = await context.cookies();
    const storage = await page.evaluate(() => ({
      localStorage: Object.keys(localStorage).map((key) => ({ key, valuePreview: String(localStorage.getItem(key) || '').slice(0, 120) })),
      sessionStorage: Object.keys(sessionStorage).map((key) => ({ key, valuePreview: String(sessionStorage.getItem(key) || '').slice(0, 120) }))
    }));
    const runtimeConsent = await page.evaluate(() => {
      const commands = [];
      const dl = Array.isArray(window.dataLayer) ? window.dataLayer.slice(-250) : [];
      for (const entry of dl) {
        try {
          const arr = Array.isArray(entry) ? entry : (entry && typeof entry === 'object' && typeof entry.length === 'number' ? Array.from(entry) : null);
          if (arr && String(arr[0] || '').toLowerCase() === 'consent') {
            commands.push(arr.slice(0, 3).map((value) => {
              if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
              return value;
            }));
          }
        } catch {}
      }
      const entries = window.google_tag_data?.ics?.entries;
      return {
        hasGoogleTagConsentState: Boolean(entries && Object.keys(entries).length),
        googleTagConsentKeys: entries ? Object.keys(entries).slice(0, 20) : [],
        dataLayerConsentCommands: commands.slice(0, 20)
      };
    }).catch(() => ({ hasGoogleTagConsentState: false, googleTagConsentKeys: [], dataLayerConsentCommands: [] }));

    const networkUrls = network.map((n) => n.url);
    const thirdPartyDomains = [...new Set(networkUrls
      .filter((url) => isThirdParty(url, final.hostname))
      .map((url) => {
        try { return new URL(url).hostname; } catch { return null; }
      })
      .filter(Boolean))].sort();

    return {
      requestedUrl: initial.url.toString(),
      finalUrl,
      finalHostname: final.hostname,
      title: dom.title,
      dom,
      cookies,
      storage,
      runtimeConsent,
      network,
      networkUrls,
      thirdPartyDomains,
      scripts: [...scripts],
      blockedRequests: blocked,
      redirectCount: chain.length - 1,
      scannedAt: new Date().toISOString(),
      scanLocation: env.scanLocation
    };
  } finally {
    clearTimeout(scanTimer);
    await context.close().catch(() => {});
  }
}
