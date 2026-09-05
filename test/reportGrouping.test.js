import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings } from '../src/report/buildFindings.js';

test('technology/storage facts are observations rather than manual failures', () => {
  const raw = {
    dom: {
      htmlMarkers: '<div id="termly-code-snippet-support"></div>',
      bannerDetected: true,
      controls: {
        accept: { text: 'Accept' },
        reject: { text: 'Decline' },
        preferences: { text: 'Preferences' },
        settingsEntry: null
      },
      policies: {
        privacy: { href: 'https://example.com/privacy' },
        cookie: { href: 'https://example.com/cookies' }
      }
    },
    scripts: ['https://app.termly.io/resource-blocker/script.js','https://www.googletagmanager.com/gtag/js?id=G-TEST123'],
    networkUrls: ['https://app.termly.io/resource-blocker/script.js','https://www.googletagmanager.com/gtag/js?id=G-TEST123'],
    network: [{ url: 'https://www.googletagmanager.com/gtag/js?id=G-TEST123', type:'script', postDataPreview: '' }],
    cookies: [{ name: 'csrf_token' }],
    storage: { localStorage: [{ key: 'TERMLY_COOKIE_CONSENT' }], sessionStorage: [] },
    thirdPartyDomains: ['app.termly.io','www.googletagmanager.com'],
    runtimeConsent: { dataLayerConsentCommands: [{ command: 'consent' }], googleTagConsentKeys: [] }
  };
  const { findings, cmps } = buildFindings(raw);
  assert.deepEqual(cmps.map((x) => x.name), ['Termly']);
  assert.ok(findings.some((f) => f.status === 'observation' && f.title === 'Google Analytics 4 detected'));
  assert.ok(findings.some((f) => f.status === 'observation' && f.title === 'Initial cookie(s) require classification'));
  assert.ok(findings.some((f) => f.status === 'observation' && f.title === 'Pre-interaction browser storage requires classification'));
  assert.ok(findings.some((f) => f.status === 'observation' && f.title === 'Pre-interaction third-party requests require classification'));
  assert.ok(findings.some((f) => f.status === 'observation' && f.title === 'Google Consent Mode-related signal detected'));
  assert.ok(findings.some((f) => f.status === 'observation' && f.title === 'Tracker library/resource loaded before interaction'));
});
