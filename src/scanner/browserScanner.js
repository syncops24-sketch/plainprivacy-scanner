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

async function inspectAllFrames(page) {
  const snapshots = [];
  for (const frame of page.frames()) {
    try {
      snapshots.push({ frame, dom: await inspectDom(frame) });
    } catch {}
  }

  if (!snapshots.length) return inspectDom(page);

  const mainFrame = page.mainFrame();
  const main = snapshots.find((item) => item.frame === mainFrame)?.dom || snapshots[0].dom;
  const pickControl = (key) => snapshots.map((item) => item.dom.controls?.[key]).find(Boolean) || null;
  const pickPolicy = (key) => snapshots.map((item) => item.dom.policies?.[key]).find(Boolean) || null;

  return {
    title: main.title,
    controls: {
      accept: pickControl('accept'),
      reject: pickControl('reject'),
      preferences: pickControl('preferences'),
      settingsEntry: pickControl('settingsEntry')
    },
    policies: {
      privacy: pickPolicy('privacy'),
      cookie: pickPolicy('cookie')
    },
    bannerDetected: snapshots.some((item) => item.dom.bannerDetected),
    bannerCandidateCount: snapshots.reduce((sum, item) => sum + (item.dom.bannerCandidateCount || 0), 0),
    htmlMarkers: snapshots.map((item) => item.dom.htmlMarkers || '').join('\n').slice(0, 500000),
    bodyText: snapshots.map((item) => item.dom.bodyText || '').join('\n').slice(0, 100000),
    shadowDomInspected: snapshots.some((item) => item.dom.shadowDomInspected),
    frameCountInspected: snapshots.length
  };
}

const SCAN_LOCATIONS = Object.freeze({
  'us-or': { label: 'Oregon, USA', username: null },
  de: { label: 'Germany', username: () => env.webshareUsernameDe },
  'us-ca': { label: 'California, USA', username: () => env.webshareUsernameUsCa },
  'us-va': { label: 'Virginia, USA', username: () => env.webshareUsernameUsVa },
  'us-ny': { label: 'New York, USA', username: () => env.webshareUsernameUsNy },
  ca: { label: 'Canada', username: () => env.webshareUsernameCanada },
  br: { label: 'Brazil', username: () => env.webshareUsernameBr }
});

export async function scanPage(inputUrl, options = {}) {
  const initial = await validatePublicUrl(inputUrl);
  const location = Object.hasOwn(SCAN_LOCATIONS, options.location) ? options.location : 'us-or';
  const locationConfig = SCAN_LOCATIONS[location];
  const proxyUsername = locationConfig.username?.() || '';
  const proxy = location === 'us-or'
    ? null
    : {
        server: `http://${env.webshareHost}:${env.websharePort}`,
        username: proxyUsername,
        password: env.websharePassword
      };

  if (location !== 'us-or' && (!env.webshareHost || !env.websharePort || !proxyUsername || !env.websharePassword)) {
    throw new Error('REGIONAL_PROXY_NOT_CONFIGURED');
  }

  const browser = await getBrowser();
  const context = await browser.newContext({
    ...(proxy ? { proxy } : {}),
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

    // Give client-rendered CMPs time to initialize, then poll visible consent UI
    // across the main document and any child frames. This improves detection for
    // asynchronously rendered and iframe-based consent interfaces without clicking them.
    await page.waitForTimeout(900).catch(() => {});
    let dom = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      dom = await inspectAllFrames(page);
      if (dom.bannerDetected || dom.controls.accept || dom.controls.reject || dom.controls.preferences) break;
      if (attempt < 5) await page.waitForTimeout(650).catch(() => {});
    }

    const finalUrl = page.url();
    const final = await validatePublicUrl(finalUrl);
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
      scanLocation: location === 'us-or' ? env.scanLocation : locationConfig.label
    };
  } finally {
    clearTimeout(scanTimer);
    await context.close().catch(() => {});
  }
}
