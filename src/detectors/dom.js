const ACCEPT_WORDS = ['accept', 'accept all', 'allow all', 'agree', 'allow cookies', 'i agree'];
const REJECT_WORDS = ['reject', 'reject all', 'deny', 'decline', 'refuse', 'essential only', 'necessary only'];
const PREF_WORDS = ['preferences', 'cookie preferences', 'privacy preferences', 'settings', 'cookie settings', 'manage cookies', 'manage preferences', 'customize', 'customise'];
const SETTINGS_WORDS = ['cookie settings', 'privacy settings', 'consent settings', 'manage consent', 'manage cookies', 'privacy choices', 'cookie preferences'];

function phraseRegex(words) {
  return new RegExp(`(?:^|\\b)(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\b|$)`, 'i');
}

export const DOM_REGEX = {
  accept: phraseRegex(ACCEPT_WORDS),
  reject: phraseRegex(REJECT_WORDS),
  preferences: phraseRegex(PREF_WORDS),
  settings: phraseRegex(SETTINGS_WORDS),
  privacyPolicy: /privacy\s*(policy|notice)/i,
  cookiePolicy: /cookie\s*(policy|notice|statement)/i,
  bannerText: /(cookie|consent)/i,
  bannerMarker: /(cookie|consent|cmp|onetrust|optanon|cookiebot|usercentrics|termly|consentmo|didomi|iubenda|complianz|osano|trustarc|quantcast|sourcepoint)/i
};

export async function inspectDom(page) {
  return page.evaluate((regexSources) => {
    const regs = Object.fromEntries(Object.entries(regexSources).map(([k, src]) => [k, new RegExp(src, 'i')]));
    const isVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const text = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 500);

    const roots = [document];
    const allElements = [];
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots[i];
      for (const el of root.querySelectorAll('*')) {
        allElements.push(el);
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }

    const controlElements = allElements
      .filter((el) => el.matches?.('button, a, input[type="button"], input[type="submit"], [role="button"], [tabindex]') && isVisible(el))
      .filter((el) => text(el));

    const ancestorChain = (el, maxDepth = 10) => {
      const chain = [];
      let current = el;
      for (let depth = 0; depth < maxDepth && current; depth += 1) {
        let parent = current.parentElement;
        if (!parent) {
          const root = current.getRootNode?.();
          parent = root && root.host instanceof Element ? root.host : null;
        }
        if (!parent) break;
        if (!['HTML', 'BODY', 'MAIN'].includes(parent.tagName)) chain.push(parent);
        current = parent;
      }
      return chain;
    };

    const looksLikeConsentRegion = (el) => {
      if (!el || !isVisible(el)) return false;
      const marker = `${text(el)} ${el.id || ''} ${String(el.className || '')}`;
      return regs.bannerMarker.test(marker) && regs.bannerText.test(marker);
    };

    // Start with conventional visible consent containers.
    const conventionalCandidates = allElements.filter((el) =>
      el.matches?.('div, section, aside, dialog, [role="dialog"], [role="alertdialog"], form') &&
      looksLikeConsentRegion(el)
    );

    // Also anchor detection around explicit consent decision controls and walk
    // upward. This catches CMPs that use custom elements or unusual wrappers.
    const controlAnchoredCandidates = [];
    for (const control of controlElements) {
      const controlText = text(control);
      const isConsentAction = regs.accept.test(controlText) || regs.reject.test(controlText) || regs.preferences.test(controlText);
      if (!isConsentAction) continue;
      const region = ancestorChain(control).find(looksLikeConsentRegion);
      if (region) controlAnchoredCandidates.push(region);
    }

    const candidates = [...new Set([...conventionalCandidates, ...controlAnchoredCandidates])];

    const bannerElements = candidates.filter((el) => {
      const descendantControls = controlElements.filter((control) => el === control || el.contains(control));
      const labels = descendantControls.map((control) => text(control));
      const hasAccept = labels.some((value) => regs.accept.test(value));
      const hasReject = labels.some((value) => regs.reject.test(value));
      const hasPreferences = labels.some((value) => regs.preferences.test(value));

      // Require a strong consent-control pattern to avoid the earlier false
      // positives from generic privacy/cookie content.
      return (hasAccept && hasReject) || (hasAccept && hasPreferences) || (hasReject && hasPreferences);
    });

    const isInsideBanner = (el) => bannerElements.some((banner) => banner === el || banner.contains(el));
    const controls = controlElements
      .map((el) => ({
        text: text(el), id: el.id || '', cls: String(el.className || '').slice(0, 200), href: el.href || '', insideBanner: isInsideBanner(el)
      }))
      .filter((x) => x.text);

    const links = allElements.filter((el) => el.matches?.('a[href]') && isVisible(el)).map((a) => ({ text: text(a), href: a.href }));
    const bodyText = (document.body?.innerText || '').slice(0, 100000);
    const htmlMarkers = document.documentElement.outerHTML.slice(0, 500000);

    const findBannerControl = (name) => controls.find((c) => c.insideBanner && regs[name].test(c.text)) || null;
    const findSettingsEntry = () => controls.find((c) => !c.insideBanner && regs.settings.test(c.text)) || null;
    const policy = (name) => links.find((l) => regs[name].test(`${l.text} ${l.href}`));

    return {
      title: document.title,
      controls: {
        accept: findBannerControl('accept'),
        reject: findBannerControl('reject'),
        preferences: findBannerControl('preferences'),
        settingsEntry: findSettingsEntry()
      },
      policies: {
        privacy: policy('privacyPolicy') || null,
        cookie: policy('cookiePolicy') || null
      },
      bannerDetected: bannerElements.length > 0,
      bannerCandidateCount: bannerElements.length,
      htmlMarkers,
      bodyText,
      shadowDomInspected: roots.length > 1,
      visibleControlCount: controlElements.length,
      consentLikeControlTexts: controlElements
        .map((el) => text(el))
        .filter((value) => regs.accept.test(value) || regs.reject.test(value) || regs.preferences.test(value))
        .slice(0, 20)
    };
  }, Object.fromEntries(Object.entries(DOM_REGEX).map(([k, re]) => [k, re.source])));
}
