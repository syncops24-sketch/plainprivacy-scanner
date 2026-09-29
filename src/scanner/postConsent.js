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
  // Lightweight post-click verifier. A withdrawal/settings control may open a
  // widget/panel that is structurally different from the initial banner, so
  // verify a newly visible consent-management region instead of requiring the
  // original banner detector to match.
  const visibleConsentRegions = async (frame) => {
    try {
      return await frame.evaluate(() => {
        const consentRe = /cookie|consent|privacy|gdpr|toestemming|datenschutz|confidentialit|privacidad|privacidade/i;
        const settingsRe = /setting|preference|manage|choice|widget|config|instelling|voorkeur|einstellung|param[eè]tre|impostaz|withdraw|intrekken|verander/i;
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (r.width <= 0 || r.height <= 0 || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
          for (let p = el.parentElement; p; p = p.parentElement) {
            const ps = getComputedStyle(p);
            if (ps.display === 'none' || ps.visibility === 'hidden' || Number(ps.opacity) === 0 || p.getAttribute('aria-hidden') === 'true') return false;
          }
          return true;
        };
        const nodes = document.querySelectorAll('[role="dialog"], [role="region"], [aria-modal="true"], div, section, aside');
        const out = [];
        for (const el of nodes) {
          if (!visible(el)) continue;
          const marker = [
            el.id, typeof el.className === 'string' ? el.className : '',
            el.getAttribute('aria-label') || '', el.getAttribute('title') || '',
            String(el.innerText || '').slice(0, 600)
          ].join(' ');
          if (!consentRe.test(marker) || !settingsRe.test(marker)) continue;
          const r = el.getBoundingClientRect();
          // Ignore tiny launcher controls; we want the management UI they open.
          if (r.width < 120 || r.height < 80) continue;
          out.push({
            tag: el.tagName.toLowerCase(), id: String(el.id || '').slice(0, 120),
            cls: String(el.className || '').slice(0, 180),
            role: String(el.getAttribute('role') || '').slice(0, 60),
            text: String(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 220),
            rect: { width: Math.round(r.width), height: Math.round(r.height) }
          });
          if (out.length >= 6) break;
        }
        return out;
      });
    } catch (error) {
      captureError('visible-consent-regions', frame, error);
      return [];
    }
  };
  const snapshotVisibleRegions = async () => {
    const regions = [];
    for (const frame of page.frames()) {
      if (!active()) break;
      const found = await visibleConsentRegions(frame);
      for (const region of found) regions.push({ frame: frameInfo(frame), ...region });
    }
    return regions;
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
  const uniqueTarget = async (action, options = {}) => {
    const handles = [];
    let ambiguous = false;
    const frames = page.frames();
    const remaining = Math.max(1, budgetMs - elapsed());
    // Settings controls are commonly injected after the first banner closes.
    // Keep each probe cheap so we can poll several times instead of allowing a
    // slow/ad frame to consume the entire interaction budget.
    const perFrameTimeoutMs = Math.min(options.fast ? 450 : 1200, remaining);
    const inspections = await Promise.all(frames.map(async (frame) => {
      let timeoutId;
      try {
        const timeout = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('target-frame-timeout')), perFrameTimeoutMs);
        });
        const handle = await Promise.race([inspect(frame, { targetAction: action }), timeout]);
        clearTimeout(timeoutId);
        const element = handle.asElement();
        if (element) {
          boundedPush(result.diagnostics.targetSearches, { action, frame: frameInfo(frame), atMs: elapsed(), outcome: 'unique-in-frame' });
          return { frame, element, ambiguous: false, timedOut: false };
        }
        const isAmbiguous = await handle.jsonValue() === 'ambiguous';
        boundedPush(result.diagnostics.targetSearches, { action, frame: frameInfo(frame), atMs: elapsed(), outcome: isAmbiguous ? 'ambiguous' : 'no-safe-target' });
        await handle.dispose();
        return { frame, element: null, ambiguous: isAmbiguous, timedOut: false };
      } catch (error) {
        clearTimeout(timeoutId);
        // A timed-out frame is inconclusive, not evidence that another frame's
        // unique visible target is unsafe. Other errors remain diagnostic only.
        const timedOut = String(error?.message || '').includes('target-frame-timeout');
        boundedPush(result.diagnostics.targetSearches, {
          action, frame: frameInfo(frame), atMs: elapsed(),
          outcome: timedOut ? 'frame-timeout-ignored' : 'frame-inspection-error'
        });
        if (!timedOut) captureError('target-' + action, frame, error);
        return { frame, element: null, ambiguous: false, timedOut };
      }
    }));
    for (const item of inspections) {
      if (item.element) handles.push({ frame: item.frame, element: item.element });
      if (item.ambiguous) ambiguous = true;
    }
    if (!ambiguous && handles.length === 1 && active()) return handles[0];
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
    while (active() && !(settings = await uniqueTarget('settings', { fast: true }))) {
      if (active() && elapsed() - lastCaptureMs >= 1500) {
        await inspectFrames();
        lastCaptureMs = elapsed();
      }
      // Poll quickly enough to catch controls injected shortly after banner close.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const regionsBeforeSettingsClick = await snapshotVisibleRegions();
    if (!settings || !await click(settings, 'settingsClicked')) return;
    result.reason = 'settings-click-did-not-reopen-interface';
    stage('waiting-for-reopen');
    const beforeKeys = new Set(regionsBeforeSettingsClick.map((r) => [r.frame.index, r.tag, r.id, r.cls, r.role].join('|')));
    while (active()) {
      if (page.url() !== initialUrl) { result.reason = 'navigation-during-consent-test'; return; }

      // Fast state-transition check first; do not spend the remaining budget on
      // full scanner diagnostics just to verify the opened management panel.
      const visibleRegions = await snapshotVisibleRegions();
      const newlyVisible = visibleRegions.find((r) => !beforeKeys.has([r.frame.index, r.tag, r.id, r.cls, r.role].join('|')));
      if (newlyVisible) {
        boundedPush(result.diagnostics.targetSearches, {
          action: 'verify-reopen', atMs: elapsed(), outcome: 'new-visible-consent-region',
          target: newlyVisible
        });
        result.status = 'passed';
        result.reason = 'consent-management-interface-opened';
        result.reopened = true;
        result.withdrawalVerified = true;
        stage('completed');
        return;
      }

      // Preserve the original banner-based verification as a fallback.
      const states = await inspectFrames();
      if (!active()) return;
      if (states?.some(({ dom }) => dom.bannerDetected)) {
        result.status = 'passed';
        result.reason = 'consent-interface-reopened';
        result.reopened = true;
        result.withdrawalVerified = true;
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
