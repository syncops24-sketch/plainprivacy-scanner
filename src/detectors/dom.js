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

    const candidateElements = allElements.filter((el) =>
      el.matches?.('div, section, aside, dialog, [role="dialog"], [role="alertdialog"], form') && isVisible(el)
    );

    const bannerElements = candidateElements.filter((el) => {
      const marker = `${text(el)} ${el.id || ''} ${String(el.className || '')}`;
      if (!regs.bannerMarker.test(marker)) return false;
      const controlCount = [...el.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')]
        .filter(isVisible).length;
      return regs.bannerText.test(marker) && (controlCount > 0 || /dialog|banner|popup|modal|cmp/i.test(marker));
    });

    const isInsideBanner = (el) => bannerElements.some((banner) => banner === el || banner.contains(el));
    const controls = allElements
      .filter((el) => el.matches?.('button, a, input[type="button"], input[type="submit"], [role="button"]') && isVisible(el))
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
      shadowDomInspected: roots.length > 1
    };
  }, Object.fromEntries(Object.entries(DOM_REGEX).map(([k, re]) => [k, re.source])));
}
