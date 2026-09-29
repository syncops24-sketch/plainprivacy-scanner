import { inspectDom } from '../detectors/dom.js';

export function freezeInitialEvidence(raw) {
  return { ...raw,
    network: [...raw.network], networkUrls: [...raw.networkUrls],
    scripts: [...raw.scripts], blockedRequests: [...raw.blockedRequests]
  };
}

// No forced clicks or inferred button positions. Each action must have exactly
// one safe target across all inspected frames. The caller freezes initial-load
// evidence before invoking this phase.
export async function testPostConsent(page, { inspect = inspectDom, budgetMs = 12000 } = {}) {
  const result = { status: 'manual', reason: 'not-started', acceptClicked: false,
    settingsClicked: false, reopened: false, withdrawalVerified: false,
    stage: 'not-started', timedOut: false,
    diagnostics: { stages: [], snapshots: [], targetSearches: [], errors: [] } };
  let stopped = false;
  let timer;
  const started = Date.now();
  const initialUrl = page.url();
  const active = () => !stopped && Date.now() - started < budgetMs;
  const elapsed = () => Date.now() - started;
  const boundedPush = (list, value, max = 8) => {
    if (!active()) return;
    list.push(value);
    if (list.length > max) list.shift();
  };
  const stage = (name) => {
    if (!active()) return;
    result.stage = name;
    boundedPush(result.diagnostics.stages, { stage: name, atMs: elapsed() });
  };
  const frameInfo = (frame) => {
    let url = '';
    try { const u = new URL(frame.url()); url = (u.origin + u.pathname).slice(0, 180); } catch {}
    return { index: page.frames().indexOf(frame), url };
  };
  const captureError = (operation, frame, error) => boundedPush(result.diagnostics.errors, {
    stage: result.stage, operation, frame: frameInfo(frame), atMs: elapsed(),
    name: String(error?.name || 'Error').slice(0, 60)
  });
  const captureSnapshot = (frame, dom) => {
    const candidates = [...(dom.withdrawalDiagnostics?.candidates || [])]
      .sort((a, b) => Number(a.insideBanner) - Number(b.insideBanner));
    boundedPush(result.diagnostics.snapshots, {
      stage: result.stage, atMs: elapsed(), frame: frameInfo(frame),
      bannerDetected: Boolean(dom.bannerDetected),
      captureError: dom.withdrawalDiagnostics?.error || null,
      candidateCount: dom.withdrawalDiagnostics?.candidateCount ?? candidates.length,
      truncated: Boolean(dom.withdrawalDiagnostics?.truncated) || candidates.length > 8,
      candidates: candidates.slice(0, 8).map((c) => ({
        tag: c.tag, id: c.id, cls: c.cls, text: c.text, ariaLabel: c.ariaLabel,
        visible: c.visible, insideBanner: c.insideBanner,
        hiddenReasons: c.hiddenReasons, inViewport: c.inViewport,
        ariaHidden: c.ariaHidden, inert: c.inert
      }))
    });
  };
  const pause = () => page.waitForTimeout(400);
  const inspectFrames = async () => {
    const states = [];
    let failed = false;
    for (const frame of page.frames()) {
      if (!active()) break;
      try {
        const dom = await inspect(frame);
        if (!active()) return null;
        states.push({ frame, dom });
        captureSnapshot(frame, dom);
      } catch (error) {
        failed = true;
        captureError('inspect-frame', frame, error);
      }
    }
    return failed ? null : states; // Unknown frame state cannot confirm disappearance.
  };
  const uniqueTarget = async (action) => {
    const handles = [];
    let failed = false;
    for (const frame of page.frames()) {
      if (!active()) { failed = true; break; }
      try {
        const handle = await inspect(frame, { targetAction: action });
        const element = handle.asElement();
        if (element) {
          handles.push({ frame, element });
          boundedPush(result.diagnostics.targetSearches, { action, frame: frameInfo(frame), atMs: elapsed(), outcome: 'unique-in-frame' });
        }
        else {
          const ambiguous = await handle.jsonValue() === 'ambiguous';
          if (ambiguous) failed = true;
          boundedPush(result.diagnostics.targetSearches, { action, frame: frameInfo(frame), atMs: elapsed(), outcome: ambiguous ? 'ambiguous' : 'no-safe-target' });
          await handle.dispose();
        }
      } catch (error) { failed = true; captureError('target-' + action, frame, error); }
    }
    if (!failed && handles.length === 1 && active()) return handles[0];
    await Promise.all(handles.map(({ element }) => element.dispose().catch(() => {})));
    return null;
  };
  const click = async (target, field) => {
    try {
      if (!active()) return false;
      stage(field === 'acceptClicked' ? 'clicking-accept' : 'clicking-settings');
      const label = await target.element.evaluate((el) =>
        String(el.getAttribute('aria-label') || el.innerText || el.id || el.className || '').slice(0, 160));
      if (!active()) return false;
      await target.element.click({ timeout: Math.min(2000, Math.max(1, budgetMs - (Date.now() - started))), noWaitAfter: true });
      if (!active()) return false;
      result[field] = true;
      result[field + 'Label'] = label;
      return true;
    } catch (error) {
      captureError('click-' + field, target.frame, error);
      throw error;
    } finally { await target.element.dispose().catch(() => {}); }
  };
  const run = async () => {
    stage('locating-accept');
    result.reason = 'no-unambiguous-accept-target';
    const accept = await uniqueTarget('accept');
    if (!accept || !await click(accept, 'acceptClicked')) return;
    result.reason = 'initial-interface-did-not-close';
    stage('waiting-for-banner-close');
    let closed = false;
    while (active()) {
      const states = await inspectFrames();
      if (!active()) return;
      if (page.url() !== initialUrl) { result.reason = 'navigation-during-consent-test'; return; }
      if (states?.length && states.every(({ dom }) => !dom.bannerDetected)) { closed = true; break; }
      await pause();
    }
    if (!closed || !active()) return;
    result.reason = 'settings-control-not-confidently-detected';
    stage('locating-settings');
    let settings;
    let lastCaptureMs = elapsed();
    while (active() && !(settings = await uniqueTarget('settings'))) {
      if (active() && elapsed() - lastCaptureMs >= 1500) {
        await inspectFrames();
        lastCaptureMs = elapsed();
      }
      await pause();
    }
    if (!settings || !await click(settings, 'settingsClicked')) return;
    result.reason = 'settings-click-did-not-reopen-interface';
    stage('waiting-for-reopen');
    while (active()) {
      const states = await inspectFrames();
      if (!active()) return;
      if (page.url() !== initialUrl) { result.reason = 'navigation-during-consent-test'; return; }
      if (states?.some(({ dom }) => dom.bannerDetected)) {
        result.status = 'passed';
        result.reason = 'consent-interface-reopened';
        result.reopened = true;
        stage('completed');
        return;
      }
      await pause();
    }
  };
  try {
    await Promise.race([
      run(),
      new Promise((resolve) => { timer = setTimeout(() => {
        stopped = true;
        result.timedOut = true;
        result.timeoutReason = 'post-consent-time-budget-exhausted';
        resolve();
      }, budgetMs); })
    ]);
  } catch {
    result.status = 'manual';
    result.reason = 'interaction-or-inspection-failed';
  } finally {
    if (!result.reopened && elapsed() >= budgetMs) {
      result.timedOut = true;
      result.timeoutReason = 'post-consent-time-budget-exhausted';
    }
    stopped = true;
    clearTimeout(timer);
  }
  // Pending browser evaluations may finish after the deadline. Return a detached
  // record so no late completion can change the logged result.
  return JSON.parse(JSON.stringify({ ...result, durationMs: elapsed() }));
}
