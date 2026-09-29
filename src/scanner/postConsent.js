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
    settingsClicked: false, reopened: false, withdrawalVerified: false };
  let stopped = false;
  let timer;
  const started = Date.now();
  const initialUrl = page.url();
  const active = () => !stopped && Date.now() - started < budgetMs;
  const pause = () => page.waitForTimeout(400);
  const inspectFrames = async () => {
    const states = [];
    for (const frame of page.frames()) {
      if (!active()) break;
      try { states.push({ frame, dom: await inspect(frame) }); }
      catch { return null; } // Unknown frame state cannot confirm disappearance.
    }
    return states;
  };
  const uniqueTarget = async (action) => {
    const handles = [];
    let failed = false;
    for (const frame of page.frames()) {
      if (!active()) { failed = true; break; }
      try {
        const handle = await inspect(frame, { targetAction: action });
        const element = handle.asElement();
        if (element) handles.push({ frame, element });
        else {
          if (await handle.jsonValue() === 'ambiguous') failed = true;
          await handle.dispose();
        }
      } catch { failed = true; }
    }
    if (!failed && handles.length === 1 && active()) return handles[0];
    await Promise.all(handles.map(({ element }) => element.dispose().catch(() => {})));
    return null;
  };
  const click = async (target, field) => {
    try {
      if (!active()) return false;
      const label = await target.element.evaluate((el) =>
        String(el.getAttribute('aria-label') || el.innerText || el.id || el.className || '').slice(0, 160));
      if (!active()) return false;
      await target.element.click({ timeout: Math.min(2000, Math.max(1, budgetMs - (Date.now() - started))), noWaitAfter: true });
      if (!active()) return false;
      result[field] = true;
      result[field + 'Label'] = label;
      return true;
    } finally { await target.element.dispose().catch(() => {}); }
  };
  const run = async () => {
    result.reason = 'no-unambiguous-accept-target';
    const accept = await uniqueTarget('accept');
    if (!accept || !await click(accept, 'acceptClicked')) return;
    result.reason = 'initial-interface-did-not-close';
    let closed = false;
    while (active()) {
      const states = await inspectFrames();
      if (page.url() !== initialUrl) { result.reason = 'navigation-during-consent-test'; return; }
      if (states?.length && states.every(({ dom }) => !dom.bannerDetected)) { closed = true; break; }
      await pause();
    }
    if (!closed || !active()) return;
    result.reason = 'settings-control-not-confidently-detected';
    let settings;
    while (active() && !(settings = await uniqueTarget('settings'))) await pause();
    if (!settings || !await click(settings, 'settingsClicked')) return;
    result.reason = 'settings-click-did-not-reopen-interface';
    while (active()) {
      const states = await inspectFrames();
      if (!active()) return;
      if (page.url() !== initialUrl) { result.reason = 'navigation-during-consent-test'; return; }
      if (states?.some(({ dom }) => dom.bannerDetected)) {
        result.status = 'passed';
        result.reason = 'consent-interface-reopened';
        result.reopened = true;
        return;
      }
      await pause();
    }
  };
  try {
    await Promise.race([
      run(),
      new Promise((resolve) => { timer = setTimeout(() => { stopped = true; result.reason = 'post-consent-time-budget-exhausted'; resolve(); }, budgetMs); })
    ]);
  } catch {
    result.status = 'manual';
    result.reason = 'interaction-or-inspection-failed';
  } finally { stopped = true; clearTimeout(timer); }
  return { ...result, durationMs: Date.now() - started };
}
