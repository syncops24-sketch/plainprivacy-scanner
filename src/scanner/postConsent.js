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
  const captureError = (operation, frame, error, extra = {}) => boundedPush(result.diagnostics.errors, {
    stage: result.stage, operation, frame: frameInfo(frame), atMs: elapsed(),
    name: String(error?.name || 'Error').slice(0, 60),
    message: String(error?.message || '').replace(/\s+/g, ' ').slice(0, 300) || null,
    ...extra
  });
  const describeTarget = async (target, action) => {
    try {
      return await target.element.evaluate((el, actionName) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
        const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
        const top = rect.width > 0 && rect.height > 0 ? document.elementFromPoint(centerX, centerY) : null;
        return {
          action: actionName,
          tag: el.tagName.toLowerCase(),
          id: String(el.id || '').slice(0, 160),
          cls: String(el.className || '').slice(0, 240),
          text: String(el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180),
          ariaLabel: String(el.getAttribute('aria-label') || '').slice(0, 180),
          role: String(el.getAttribute('role') || '').slice(0, 80),
          href: String(el.getAttribute('href') || '').slice(0, 240),
          connected: el.isConnected,
          disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
          topElement: top ? {
            tag: top.tagName?.toLowerCase() || '',
            id: String(top.id || '').slice(0, 120),
            cls: String(top.className || '').slice(0, 180),
            sameOrDescendant: top === el || el.contains(top)
          } : null
        };
      }, action);
    } catch (error) {
      captureError('describe-' + action, target.frame, error);
      return null;
    }
  };
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
    // Inspect frames concurrently. A slow third-party iframe must not consume the
    // entire post-consent budget after the main document has already produced a
    // safe settings target.
    const frames = page.frames();
    const remaining = Math.max(1, budgetMs - elapsed());
    const perFrameTimeoutMs = Math.min(1500, remaining);
    const inspections = await Promise.all(frames.map(async (frame) => {
      try {
        const handle = await Promise.race([
          inspect(frame, { targetAction: action }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('target-frame-timeout')), perFrameTimeoutMs))
        ]);
        const element = handle.asElement();
        if (element) {
          boundedPush(result.diagnostics.targetSearches, { action, frame: frameInfo(frame), atMs: elapsed(), outcome: 'unique-in-frame' });
          return { frame, element, failed: false };
        }
        const ambiguous = await handle.jsonValue() === 'ambiguous';
        boundedPush(result.diagnostics.targetSearches, { action, frame: frameInfo(frame), atMs: elapsed(), outcome: ambiguous ? 'ambiguous' : 'no-safe-target' });
        await handle.dispose();
        return { frame, element: null, failed: ambiguous };
      } catch (error) {
        captureError('target-' + action, frame, error);
        return { frame, element: null, failed: true };
      }
    }));
    for (const item of inspections) {
      if (item.element) handles.push({ frame: item.frame, element: item.element });
      if (item.failed) failed = true;
    }
    if (!failed && handles.length === 1 && active()) return handles[0];
    await Promise.all(handles.map(({ element }) => element.dispose().catch(() => {})));
    return null;
  };
  const click = async (target, field) => {
    const action = field === 'acceptClicked' ? 'accept' : 'settings';
    let selectedTarget = null;
    try {
      if (!active()) return false;
      stage(action === 'accept' ? 'clicking-accept' : 'clicking-settings');
      selectedTarget = await describeTarget(target, action);
      boundedPush(result.diagnostics.targetSearches, {
        action, frame: frameInfo(target.frame), atMs: elapsed(),
        outcome: 'selected-for-click', target: selectedTarget
      });
      const label = selectedTarget?.ariaLabel || selectedTarget?.text || selectedTarget?.id || selectedTarget?.cls || '';
      if (!active()) return false;
      try {
        await target.element.click({ timeout: Math.min(2000, Math.max(1, budgetMs - (Date.now() - started))), noWaitAfter: true });
      } catch (error) {
        // The target was already selected conservatively and verified visible/actionable.
        // Some CMP widgets use SVG children/animation layers that make Playwright's
        // actionability click time out even though the button itself is usable.
        // Fall back to the element's native click, then rely on the subsequent
        // state-change verification before treating the interaction as successful.
        const fallbackTarget = await describeTarget(target, action);
        const safeFallback = fallbackTarget?.connected &&
          !fallbackTarget?.disabled &&
          fallbackTarget?.display !== 'none' &&
          fallbackTarget?.visibility !== 'hidden' &&
          Number(fallbackTarget?.opacity ?? 1) > 0 &&
          fallbackTarget?.pointerEvents !== 'none' &&
          fallbackTarget?.rect?.width > 0 &&
          fallbackTarget?.rect?.height > 0;
        if (!safeFallback) throw error;
        boundedPush(result.diagnostics.targetSearches, {
          action, frame: frameInfo(target.frame), atMs: elapsed(),
          outcome: 'playwright-click-timeout-native-click-fallback',
          target: fallbackTarget
        });
        await target.element.evaluate((el) => el.click());
      }
      if (!active()) return false;
      result[field] = true;
      result[field + 'Label'] = label;
      return true;
    } catch (error) {
      const afterFailure = await describeTarget(target, action);
      captureError('click-' + field, target.frame, error, {
        selectedTarget,
        targetAfterFailure: afterFailure
      });
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
