import test from 'node:test';
import assert from 'node:assert/strict';
import { createWithdrawalTimeline } from '../src/scanner/withdrawalDiagnostics.js';
import { inspectDom } from '../src/detectors/dom.js';
import vm from 'node:vm';

const candidate = (key, visible = false, insideBanner = false) => ({
  key, visible, insideBanner,
  hiddenReasons: visible ? [] : ['ancestor:display-none']
});
const snapshot = (at, candidates, documentId = '1000') => ({
  documentId, observedAtMs: at, truncated: false, candidates
});

test('retains hidden controls and records their first visible observation', () => {
  const timeline = createWithdrawalTimeline();
  const frame = {};
  timeline.record(frame, snapshot(100, [candidate('widget')]));
  timeline.record(frame, snapshot(850, [candidate('widget', true)]));
  const output = timeline.finish();
  const record = output.candidates[0];
  assert.equal(record.firstSeenMs, 100);
  assert.equal(record.firstVisibleMs, 850);
  assert.equal(record.observations, 2);
  assert.equal(record.transitions.length, 2);
  assert.deepEqual(record.transitions[0].state.hiddenReasons, ['ancestor:display-none']);
  assert.equal(output.observationSpanMs, 750);
});

test('late arrivals are first seen at the later sample, not at navigation', () => {
  const timeline = createWithdrawalTimeline();
  const frame = {};
  timeline.record(frame, snapshot(100, []));
  timeline.record(frame, snapshot(850, [candidate('custom', true)]));
  assert.equal(timeline.finish().candidates[0].firstSeenMs, 850);
});

test('disappearance is distinguishable from a hidden element', () => {
  const timeline = createWithdrawalTimeline();
  const frame = {};
  timeline.record(frame, snapshot(100, [candidate('widget', true)]));
  timeline.record(frame, snapshot(850, []));
  const record = timeline.finish().candidates[0];
  assert.equal(record.presentInLastSample, false);
  assert.equal(record.lastSeenMs, 100);
});

test('identical paths in separate frames and navigations stay separate', () => {
  const timeline = createWithdrawalTimeline();
  const a = {}, b = {};
  timeline.record(a, snapshot(100, [candidate('button')]));
  timeline.record(b, snapshot(100, [candidate('button')]));
  timeline.record(a, snapshot(50, [candidate('button')], '2000'));
  assert.equal(timeline.finish().candidateCount, 3);
  assert.equal(timeline.finish().frameCount, 2);
});

test('caps candidates and prioritizes external controls in log output', () => {
  const timeline = createWithdrawalTimeline();
  timeline.record({}, snapshot(100, Array.from({ length: 80 }, (_, i) => candidate(String(i), true, i < 20))));
  const output = timeline.finish();
  assert.equal(output.candidateCount, 60);
  assert.equal(output.candidates.length, 30);
  assert.equal(output.candidates[0].candidate.insideBanner, false);
  assert.equal(output.truncated, true);
});

test('caps changing visibility histories and reports truncation', () => {
  const timeline = createWithdrawalTimeline();
  const frame = {};
  for (let i = 0; i < 20; i += 1) timeline.record(frame, snapshot(i, [candidate('widget', i % 2 === 0)]));
  assert.equal(timeline.finish().candidates[0].transitions.length, 6);
  assert.equal(timeline.finish().truncated, true);
});

test('capture failures and candidate truncation are explicit', () => {
  const timeline = createWithdrawalTimeline();
  timeline.failed();
  timeline.record({}, { error: 'diagnostic-capture-failed' });
  timeline.record({}, { ...snapshot(100, []), truncated: true });
  assert.equal(timeline.finish().failedSamples, 2);
  assert.equal(timeline.finish().truncated, true);
});

test('late external controls displace banner records when the history is full', () => {
  const timeline = createWithdrawalTimeline();
  const frame = {};
  timeline.record(frame, snapshot(100, Array.from({ length: 60 }, (_, i) => candidate(String(i), true, true))));
  timeline.record(frame, snapshot(850, [candidate('late-widget', true)]));
  assert.equal(timeline.finish().candidates[0].candidate.key, 'late-widget');
});

// Small DOM fixture tests exercise the actual serialized evaluate callback.
// Layout/computed styles are supplied explicitly; these are not browser E2E tests.
function fixturePage({ hidden = false, neutral = false } = {}) {
  class Element {
    constructor(tag, attrs = {}, style = {}) {
      this.tagName = tag.toUpperCase(); this.attrs = attrs; this.id = attrs.id || '';
      this.className = attrs.class || ''; this.children = []; this.textContent = '';
      this.style = { visibility: 'visible', display: 'block', opacity: '1', position: 'static', ...style };
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    getRootNode() { return document; }
    matches(selector) {
      return selector.split(',').some((s) => {
        s = s.trim();
        if (s === this.tagName.toLowerCase()) return true;
        const m = s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        return m ? this.hasAttribute(m[1]) && (m[2] === undefined || this.getAttribute(m[1]) === m[2]) : false;
      });
    }
    getBoundingClientRect() { return { x: 5, y: 5, width: 40, height: 40, top: 5, left: 5, bottom: 45, right: 45 }; }
    append(child) { this.children.push(child); child.parentNode = this; child.parentElement = this; }
    querySelectorAll() { return this.children.flatMap((child) => [child, ...child.querySelectorAll()]); }
  }
  const html = new Element('html');
  const body = new Element('body');
  const host = new Element('div', neutral ? {} : { id: 'privacy-widget' }, { display: hidden ? 'none' : 'block', position: 'fixed' });
  const button = new Element('button', neutral ? { 'aria-controls': 'panel' } : { 'aria-label': 'Open het cookie-instellingen widget' });
  html.append(body); body.append(host); host.append(button);
  const document = { documentElement: html, body, title: 'Fixture', baseURI: 'https://example.test/', querySelectorAll: () => [html, ...html.querySelectorAll()] };
  const context = { document, Element, HTMLInputElement: class extends Element {}, ShadowRoot: class {},
    getComputedStyle: (el) => el.style, performance: { timeOrigin: 1000, now: () => 250 },
    innerWidth: 1440, innerHeight: 1000, URL };
  return { evaluate: (fn, sources) => vm.runInNewContext('(' + fn.toString() + ')(sources)', { ...context, sources }) };
}

test('DOM logger retains a control hidden by its ancestor with an explicit reason', async () => {
  const dom = await inspectDom(fixturePage({ hidden: true }));
  assert.equal(dom.withdrawalDiagnostics.error, undefined);
  const item = dom.withdrawalDiagnostics.candidates[0];
  assert.equal(item.visible, false);
  assert.ok(item.hiddenReasons.includes('ancestor:display-none'));
  assert.equal(item.ariaLabel, 'Open het cookie-instellingen widget');
});

test('unlabelled fixed controls can enter diagnostics without CMP or language markers', async () => {
  const dom = await inspectDom(fixturePage({ neutral: true }));
  const item = dom.withdrawalDiagnostics.candidates[0];
  assert.equal(item.visible, true);
  assert.ok(item.reasons.includes('persistent-icon-control'));
  assert.ok(item.reasons.includes('controls-or-opens-region'));
  assert.equal(dom.controls.settingsEntry, null);
});
