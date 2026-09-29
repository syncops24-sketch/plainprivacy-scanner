import test from 'node:test';
import assert from 'node:assert/strict';
import { testPostConsent, freezeInitialEvidence } from '../src/scanner/postConsent.js';
import { buildFindings } from '../src/report/buildFindings.js';

function fixture({ ambiguous = false, closes = true, reopens = true, clickFails = false, navigates = false, frameFails = false, delayWidget = 0 } = {}) {
  const frame = {};
  let state = 'initial', polls = 0;
  const clicks = [];
  const page = {
    url: () => navigates && state !== 'initial' ? 'https://example.test/other' : 'https://example.test/',
    frames: () => [frame],
    waitForTimeout: () => new Promise((resolve) => setTimeout(resolve, 1))
  };
  const inspect = async (_, options = {}) => {
    if (frameFails) throw new Error('frame detached');
    if (!options.targetAction) return { bannerDetected: state === 'initial' || state === 'reopened' };
    const action = options.targetAction;
    const available = action === 'accept' ? state === 'initial' : state === 'accepted' && polls++ >= delayWidget;
    const element = {
      evaluate: async () => action === 'accept' ? 'Alles toestaan' : 'Open cookie-instellingen',
      click: async () => {
        if (clickFails) throw new Error('not actionable');
        clicks.push(action);
        if (action === 'accept' && closes) state = 'accepted';
        if (action === 'settings' && reopens) state = 'reopened';
      },
      dispose: async () => {}
    };
    return {
      asElement: () => available && !ambiguous ? element : null,
      jsonValue: async () => ambiguous ? 'ambiguous' : null,
      dispose: async () => {}
    };
  };
  return { page, inspect, clicks };
}

test('Accept, close, delayed widget, reopen succeeds without claiming withdrawal', async () => {
  const f = fixture({ delayWidget: 2 });
  const result = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 200 });
  assert.deepEqual(f.clicks, ['accept', 'settings']);
  assert.equal(result.reopened, true);
  assert.equal(result.withdrawalVerified, false);
  assert.equal(result.status, 'passed');
});

test('ambiguous controls are not clicked', async () => {
  const f = fixture({ ambiguous: true });
  const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 100 });
  assert.equal(r.status, 'manual');
  assert.deepEqual(f.clicks, []);
});

test('an interface that never closes cannot pass reopening', async () => {
  const f = fixture({ closes: false });
  const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 30 });
  assert.equal(r.reopened, false);
  assert.deepEqual(f.clicks, ['accept']);
  assert.equal(r.stage, 'waiting-for-banner-close');
  assert.equal(r.reason, 'initial-interface-did-not-close');
  assert.equal(r.timedOut, true);
  assert.equal(r.timeoutReason, 'post-consent-time-budget-exhausted');
});

test('clicking a widget without reopening is manual', async () => {
  const f = fixture({ reopens: false });
  const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 30 });
  assert.equal(r.reopened, false);
  assert.equal(r.settingsClicked, true);
  assert.equal(r.status, 'manual');
  assert.equal(r.stage, 'waiting-for-reopen');
  assert.equal(r.reason, 'settings-click-did-not-reopen-interface');
});

test('missing widget timeout preserves settings-search stage and target outcomes', async () => {
  const f = fixture({ delayWidget: 100000 });
  const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 30 });
  assert.equal(r.stage, 'locating-settings');
  assert.equal(r.reason, 'settings-control-not-confidently-detected');
  assert.equal(r.timedOut, true);
  assert.ok(r.diagnostics.targetSearches.some((s) => s.action === 'settings' && s.outcome === 'no-safe-target'));
});

test('captures bounded post-click candidates, prioritizing external controls', async () => {
  const f = fixture();
  const inspect = async (frame, options) => {
    const value = await f.inspect(frame, options);
    if (!options?.targetAction) value.withdrawalDiagnostics = {
      candidateCount: 13, candidates: Array.from({ length: 13 }, (_, i) => ({
        id: i === 12 ? 'privacy-widget' : 'internal-' + i,
        insideBanner: i !== 12, visible: i === 12, hiddenReasons: i === 12 ? [] : ['ancestor:display-none']
      }))
    };
    return value;
  };
  const r = await testPostConsent(f.page, { inspect, budgetMs: 200 });
  const snapshot = r.diagnostics.snapshots[0];
  assert.equal(snapshot.stage, 'waiting-for-banner-close');
  assert.equal(snapshot.candidates.length, 8);
  assert.equal(snapshot.candidates[0].id, 'privacy-widget');
  assert.equal(snapshot.truncated, true);
});

test('frame errors retain operation and stage without dumping error messages', async () => {
  const f = fixture({ frameFails: true });
  const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 100 });
  assert.equal(r.diagnostics.errors[0].operation, 'target-accept');
  assert.equal(r.diagnostics.errors[0].stage, 'locating-accept');
  assert.equal(r.diagnostics.errors[0].name, 'Error');
  assert.equal(r.diagnostics.errors[0].message, undefined);
});

test('a late browser evaluation cannot mutate the returned timeout record', async () => {
  const f = fixture();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const inspect = async (frame, options) => options?.targetAction ? f.inspect(frame, options) : pending;
  const r = await testPostConsent(f.page, { inspect, budgetMs: 30 });
  const before = JSON.stringify(r);
  release({ bannerDetected: false });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(JSON.stringify(r), before);
  assert.equal(r.stage, 'waiting-for-banner-close');
  assert.equal(r.timedOut, true);
});

test('failed clicks and inaccessible frames degrade to manual', async () => {
  for (const config of [{ clickFails: true }, { frameFails: true }]) {
    const f = fixture(config);
    const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 100 });
    assert.equal(r.status, 'manual');
    assert.equal(r.reopened, false);
  }
});

test('navigation after Accept stops the test', async () => {
  const f = fixture({ navigates: true });
  const r = await testPostConsent(f.page, { inspect: f.inspect, budgetMs: 100 });
  assert.equal(r.reason, 'navigation-during-consent-test');
  assert.deepEqual(f.clicks, ['accept']);
});

test('post-consent events cannot contaminate initial network evidence', () => {
  const raw = { network: [{ url: 'https://example.test/' }], networkUrls: ['https://example.test/'], scripts: [], blockedRequests: [] };
  const snapshot = freezeInitialEvidence(raw);
  raw.network.push({ url: 'https://analytics.test/collect' });
  raw.networkUrls.push('https://analytics.test/collect');
  raw.scripts.push('tracking.js');
  raw.blockedRequests.push({ reason: 'request-limit' });
  assert.equal(snapshot.network.length, 1);
  assert.equal(snapshot.networkUrls.length, 1);
  assert.equal(snapshot.scripts.length, 0);
  assert.equal(snapshot.blockedRequests.length, 0);
});

test('report passes reopening only on confirmed success and qualifies its meaning', () => {
  const raw = {
    dom: { htmlMarkers: '', bodyText: '', bannerDetected: true, controls: {}, policies: {} },
    cookies: [], network: [], networkUrls: [], scripts: [], thirdPartyDomains: [],
    storage: { localStorage: [], sessionStorage: [] }
  };
  const settings = () => buildFindings(raw).findings.find((f) => f.key === 'settings_entry');
  raw.postConsent = { status: 'manual', reopened: false, settingsClicked: true };
  assert.equal(settings().status, 'manual');
  raw.postConsent = { status: 'passed', reopened: true, settingsClickedLabel: 'Cookie settings' };
  assert.equal(settings().status, 'passed');
  assert.match(settings().title, /reopened/);
  assert.match(settings().why, /does not verify withdrawal/i);
});
