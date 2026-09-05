import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPreInteractionTrackerTraffic, detectPotentialNonessentialCookies, detectTrackers } from '../src/detectors/trackers.js';
import { detectCmps } from '../src/detectors/cmp.js';
import { detectConsentMode } from '../src/detectors/consentMode.js';

test('detects common technologies from network/script/cookie evidence', () => {
  const raw = {
    dom: { htmlMarkers: '<div id="CybotCookiebotDialog"></div>' },
    scripts: ['https://www.googletagmanager.com/gtm.js?id=GTM-AAA', 'https://connect.facebook.net/en_US/fbevents.js'],
    networkUrls: ['https://www.google-analytics.com/g/collect?v=2&tid=G-ABC12345', 'https://www.facebook.com/tr?id=123456789'],
    cookies: [{ name:'_ga' }, { name:'_fbp' }]
  };
  assert.ok(detectCmps(raw).some((x) => x.name === 'Cookiebot'));
  const trackers = detectTrackers(raw);
  const ids = trackers.map((x) => x.id);
  assert.ok(ids.includes('gtm'));
  assert.ok(ids.includes('ga4'));
  assert.ok(ids.includes('meta_pixel'));
  assert.equal(detectPotentialNonessentialCookies(raw.cookies).length, 2);
  assert.ok(classifyPreInteractionTrackerTraffic(raw, trackers).strongConcerns.some((x) => x.name === 'Meta Pixel'));
});

test('does not treat Google consent-related ping as a high-confidence network concern by itself', () => {
  const raw = {
    dom: { htmlMarkers:'', bodyText:'' }, scripts: [], cookies: [],
    networkUrls: ['https://www.google-analytics.com/g/collect?v=2&tid=G-ABC12345&gcs=G100&pscdl=denied']
  };
  const trackers = detectTrackers(raw);
  const traffic = classifyPreInteractionTrackerTraffic(raw, trackers);
  assert.equal(traffic.strongConcerns.length, 0);
  assert.equal(traffic.googleSignals.length, 1);
});

test('Consent Mode detection only asserts presence of related signals', () => {
  const result = detectConsentMode({
    network:[{ url:'https://www.google-analytics.com/g/collect?v=2&gcs=G100&gcd=13l3l3l3l5', postDataPreview:'' }],
    dom:{ htmlMarkers:'', bodyText:'' },
    runtimeConsent:{}
  });
  assert.equal(result.detected, true);
  assert.equal(result.confidence, 'High');
});


test('CMP detection ignores vendor names mentioned only in ordinary page copy', () => {
  const raw = {
    dom: { htmlMarkers: '<main><p>We review Shopify Customer Privacy, TrustArc, Cookiebot and Usercentrics implementations.</p></main>' },
    scripts: [],
    networkUrls: []
  };
  assert.deepEqual(detectCmps(raw), []);
});

test('CMP detection returns evidence for real Termly signals without unrelated CMP false positives', () => {
  const raw = {
    dom: { htmlMarkers: '<div id="termly-code-snippet-support"></div><p>We review Shopify Customer Privacy and TrustArc.</p>' },
    scripts: ['https://app.termly.io/embed-policy.min.js'],
    networkUrls: ['https://app.termly.io/resource-blocker/abc']
  };
  const cmps = detectCmps(raw);
  assert.deepEqual(cmps.map((x) => x.name), ['Termly']);
  assert.ok(cmps[0].evidence.length > 0);
});

test('does not detect CookieYes from a generic cky- class fragment alone', () => {
  const cmps = detectCmps({
    dom: { htmlMarkers: '<div class="termly-blocker cky-random-fragment"></div>' },
    scripts: ['https://app.termly.io/resource-blocker/script.js'],
    networkUrls: ['https://app.termly.io/api/v1/snippets/websites/example']
  });
  assert.deepEqual(cmps.map((x) => x.name), ['Termly']);
});

test('detects CookieYes from a specific consent container signature', () => {
  const cmps = detectCmps({
    dom: { htmlMarkers: '<div class="cky-consent-container"></div>' },
    scripts: [],
    networkUrls: []
  });
  assert.ok(cmps.some((x) => x.name === 'CookieYes'));
});

test('Meta library load alone is an observation, not a pre-interaction collection concern', () => {
  const raw = {
    dom: { htmlMarkers:'', bodyText:'' },
    scripts: ['https://connect.facebook.net/en_US/fbevents.js'],
    networkUrls: ['https://connect.facebook.net/en_US/fbevents.js'],
    network: [{ url:'https://connect.facebook.net/en_US/fbevents.js', type:'script', method:'GET', postDataPreview:'' }],
    cookies: []
  };
  const trackers = detectTrackers(raw);
  const traffic = classifyPreInteractionTrackerTraffic(raw, trackers);
  assert.equal(traffic.strongConcerns.length, 0);
  assert.ok(traffic.librarySignals.some((x) => x.name === 'Meta Pixel'));
});

test('Meta collection endpoint is a stronger pre-interaction concern', () => {
  const raw = {
    dom: { htmlMarkers:'', bodyText:'' },
    scripts: ['https://connect.facebook.net/en_US/fbevents.js'],
    networkUrls: [
      'https://connect.facebook.net/en_US/fbevents.js',
      'https://www.facebook.com/tr?id=123456789&ev=PageView'
    ],
    network: [
      { url:'https://connect.facebook.net/en_US/fbevents.js', type:'script', method:'GET', postDataPreview:'' },
      { url:'https://www.facebook.com/tr?id=123456789&ev=PageView', type:'image', method:'GET', postDataPreview:'' }
    ],
    cookies: []
  };
  const trackers = detectTrackers(raw);
  const traffic = classifyPreInteractionTrackerTraffic(raw, trackers);
  assert.ok(traffic.strongConcerns.some((x) => x.name === 'Meta Pixel'));
  assert.ok(traffic.strongConcerns.some((x) => /facebook\.com\/tr\?/i.test(x.evidence[0])));
});

test('Google tag library load alone is not treated as a Google collection ping', () => {
  const raw = {
    dom: { htmlMarkers:'', bodyText:'' },
    scripts: ['https://www.googletagmanager.com/gtag/js?id=G-ABC12345'],
    networkUrls: ['https://www.googletagmanager.com/gtag/js?id=G-ABC12345'],
    network: [{ url:'https://www.googletagmanager.com/gtag/js?id=G-ABC12345', type:'script', method:'GET', postDataPreview:'' }],
    cookies: []
  };
  const trackers = detectTrackers(raw);
  const traffic = classifyPreInteractionTrackerTraffic(raw, trackers);
  assert.equal(traffic.strongConcerns.length, 0);
  assert.equal(traffic.googleSignals.length, 0);
  assert.ok(traffic.librarySignals.some((x) => x.name === 'Google Analytics 4'));
});


test('Consentmo is not detected from generic gdpr-backpack text alone', () => {
  const cmps = detectCmps({
    dom: { htmlMarkers: '<div class="gdpr-backpack-helper">Example</div>' },
    scripts: ['https://example.com/assets/gdpr-backpack.js'],
    networkUrls: ['https://example.com/assets/gdpr-backpack.js']
  });
  assert.equal(cmps.some((cmp) => cmp.name === 'Consentmo'), false);
});

test('Consentmo is detected from Consentmo-specific Shopify extension evidence', () => {
  const url = 'https://cdn.shopify.com/extensions/01a06c95-efb2-78e0-926d-18b6cdab4cd6/gdpr-backpack-869/assets/layout-cookie-bar.consentmo.js';
  const cmps = detectCmps({
    dom: { htmlMarkers: '' },
    scripts: [url],
    networkUrls: [url]
  });
  assert.equal(cmps.some((cmp) => cmp.name === 'Consentmo'), true);
});


test('Consentmo is not detected from Cookiebot consentmode query parameters', () => {
  const url = 'https://consent.cookiebot.com/uc.js?cbid=abc&implementation=gtm&consentmode-dataredaction=dynamic';
  const cmps = detectCmps({
    dom: { htmlMarkers: '' },
    scripts: [url],
    networkUrls: [url]
  });
  assert.equal(cmps.some((cmp) => cmp.name === 'Consentmo'), false);
});
