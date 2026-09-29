const ACCEPT_WORDS = ['accept', 'accept all', 'allow all', 'agree', 'allow cookies', 'i agree', 'yes, i agree', 'got it', 'alles toestaan', 'accepteren', 'alle akzeptieren', 'akzeptieren', 'tout accepter', 'accepter', 'aceptar todo', 'aceptar', 'accetta tutto', 'accetta', 'aceitar tudo', 'aceitar'];
const REJECT_WORDS = ['reject', 'reject all', 'deny', 'decline', 'refuse', 'essential only', 'necessary only', 'continue without accepting', 'alles weigeren', 'weigeren', 'alle ablehnen', 'ablehnen', 'tout refuser', 'refuser', 'rechazar todo', 'rechazar', 'rifiuta tutto', 'rifiuta', 'rejeitar tudo', 'rejeitar'];
const PREF_WORDS = ['preferences', 'cookie preferences', 'privacy preferences', 'settings', 'cookie settings', 'manage cookies', 'manage preferences', 'customize', 'customise', 'manage options', 'show purposes', 'aanpassen', 'voorkeuren', 'instellingen', 'einstellungen', 'anpassen', 'präferenzen', 'paramètres', 'personnaliser', 'préférences', 'configuración', 'personalizar', 'preferencias', 'impostazioni', 'personalizza', 'preferenze', 'configurações', 'personalizar', 'preferências'];
const SETTINGS_WORDS = ['cookie settings', 'privacy settings', 'consent settings', 'manage consent', 'manage cookies', 'privacy choices', 'cookie preferences', 'consent preferences', 'manage preferences', 'cookie-instellingen', 'cookie instellingen', 'toestemmingsinstellingen', 'cookie-einstellungen', 'datenschutzeinstellungen', 'paramètres des cookies', 'paramètres de confidentialité', 'configuración de cookies', 'configuración de privacidad', 'impostazioni cookie', 'impostazioni privacy', 'configurações de cookies', 'configurações de privacidade'];

function phraseRegex(words) {
  const escaped = words.map((w) => w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  return new RegExp('(?:^|\\b)(' + escaped.join('|') + ')(?:\\b|$)', 'i');
}

export const DOM_REGEX = {
  accept: phraseRegex(ACCEPT_WORDS),
  reject: phraseRegex(REJECT_WORDS),
  preferences: phraseRegex(PREF_WORDS),
  settings: phraseRegex(SETTINGS_WORDS),
  privacyPolicy: /(?:privacy(?:\s*(?:policy|notice|statement|verklaring))?|privacyverklaring|datenschutz(?:erklärung)?|confidentialit[eé]|politique\s+de\s+confidentialit[eé]|privacidad|pol[ií]tica\s+de\s+privacidad|informativa\s+privacy|pol[ií]tica\s+de\s+privacidade)/i,
  cookiePolicy: /(?:cookie(?:s)?\s*(?:policy|notice|statement|beleid|verklaring)|cookiebeleid|cookieverklaring|cookie-richtlinie|politique\s+de\s+cookies|pol[ií]tica\s+de\s+cookies|informativa\s+cookie)/i,
  bannerText: /(cookie|cookies|consent|privacy choice|tracking preference|toestemming|datenschutz|confidentialit[eé]|privacidad|privacidade)/i,
  bannerMarker: /(cookie|consent|cmp|gdpr|ccpa|privacy|onetrust|optanon|cookiebot|usercentrics|termly|consentmo|didomi|iubenda|complianz|osano|trustarc|quantcast|sourcepoint|cookieyes|cky|csm)/i
};

export async function inspectDom(page, { targetAction = null } = {}) {
  const evaluate = targetAction ? page.evaluateHandle.bind(page) : page.evaluate.bind(page);
  return evaluate(({ regexSources, targetAction }) => {
    const regs = Object.fromEntries(Object.entries(regexSources).map(([k, src]) => [k, new RegExp(src, 'i')]));

    const composedParent = (el) => {
      if (!el) return null;
      if (el.parentElement) return el.parentElement;
      const root = el.getRootNode?.();
      return root && root.host instanceof Element ? root.host : null;
    };

    const composedAncestors = (el, maxDepth = 16) => {
      const chain = [];
      let current = el;
      for (let depth = 0; depth < maxDepth; depth += 1) {
        current = composedParent(current);
        if (!current) break;
        chain.push(current);
      }
      return chain;
    };

    const composedContains = (ancestor, node) => {
      if (!ancestor || !node) return false;
      if (ancestor === node) return true;
      let current = node;
      for (let depth = 0; depth < 32 && current; depth += 1) {
        current = composedParent(current);
        if (current === ancestor) return true;
      }
      return false;
    };

    const roots = [document];
    const allElements = [];
    for (let i = 0; i < roots.length; i += 1) {
      const root = roots[i];
      for (const el of root.querySelectorAll('*')) {
        allElements.push(el);
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }

    const isVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };

    const ownText = (el) => {
      if (!(el instanceof Element)) return '';
      const inputValue = el instanceof HTMLInputElement ? (el.value || '') : '';
      const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-label') || '';
      const visibleText = el.innerText || el.textContent || '';
      const shadowText = el.shadowRoot?.textContent || '';
      return [visibleText, shadowText, inputValue, label]
        .filter(Boolean)
        .join(' ')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 1200);
    };

    const markerText = (el) => {
      if (!(el instanceof Element)) return '';
      return [
        ownText(el),
        el.tagName?.toLowerCase() || '',
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute('role') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('data-cy') || ''
      ].join(' ').slice(0, 2500);
    };

    const actionType = (value) => {
      const s = String(value || '').trim();
      if (!s || s.length > 180) return null;
      if (regs.accept.test(s)) return 'accept';
      if (regs.reject.test(s)) return 'reject';
      if (regs.preferences.test(s)) return 'preferences';
      return null;
    };

    const semanticControlSelector = [
      'button',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
      '[role="menuitem"]',
      '[tabindex]',
      '[onclick]',
      '[data-action]',
      '[data-testid]'
    ].join(',');

    // Prefer language-neutral DOM/accessibility metadata when it carries
    // recognizable consent semantics. Vendor names may contribute context but
    // are never sufficient on their own.
    const structuralActionType = (el) => {
      if (!(el instanceof Element)) return null;
      const metadata = [
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute('name') || '',
        el.getAttribute('data-action') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || ''
      ].join(' ').toLowerCase();
      if (/(accept|allow[-_ ]?all|optin|opt-in|agree)/i.test(metadata)) return 'accept';
      if (/(reject|deny|decline|refuse|optout|opt-out)/i.test(metadata)) return 'reject';
      if (/(preference|settings|setting|customi[sz]e|manage)/i.test(metadata)) return 'preferences';
      return null;
    };

    const resolvedActionType = (el) => actionType(ownText(el)) || structuralActionType(el);

    const consentStructuralMarker = (el) => {
      const metadata = markerText(el);
      return regs.bannerMarker.test(metadata)
        || /(?:cookie|consent|privacy|gdpr|cmp)/i.test(metadata);
    };

    const controlElements = [];
    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const label = ownText(el);
      const type = actionType(label) || structuralActionType(el);
      if (!type) continue;

      const semantic = el.matches?.(semanticControlSelector);
      const childWithSameAction = [...el.children].some((child) => resolvedActionType(child));
      const leafish = el.children.length <= 3 && !childWithSameAction && label.length <= 100;
      const controlishMarker = /(button|btn|action|choice|option|preference|accept|reject|decline|allow|deny)/i.test(markerText(el));

      if (semantic || leafish || controlishMarker) controlElements.push(el);
    }

    const uniqueControls = [...new Set(controlElements)];

    const rootConsentClusters = [];
    for (const root of roots) {
      // The document can contain unrelated consent-themed examples and footer
      // links. Only a shadow root is a bounded fallback consent region.
      if (!(root instanceof ShadowRoot)) continue;
      const controlsInRoot = uniqueControls.filter((control) => control.getRootNode?.() === root);
      const types = new Set(controlsInRoot.map((control) => resolvedActionType(control)).filter(Boolean));
      if (types.size < 2 || (!types.has('accept') && !types.has('reject'))) continue;

      const rootText = (root.textContent || '') + ' ' + markerText(root.host);

      if (!regs.bannerText.test(rootText) && !regs.bannerMarker.test(rootText)) continue;

      rootConsentClusters.push({
        root,
        host: root.host,
        controls: controlsInRoot
      });
    }

    const looksLikeConsentRegion = (el) => {
      if (!el || !isVisible(el)) return false;
      const structuralMarker = [el.tagName, el.id, typeof el.className === 'string' ? el.className : '', el.getAttribute?.('role'), el.getAttribute?.('aria-label')].join(' ');
      const explicitMarker = regs.bannerMarker.test(structuralMarker);
      const consentText = regs.bannerText.test(ownText(el));
      const role = el.getAttribute?.('role') || '';
      const tag = el.tagName?.toLowerCase() || '';
      const customConsentElement = /(?:cookie|consent|cmp|gdpr|privacy)/i.test(tag);
      const dialogLike = /dialog|alertdialog|region/i.test(role);
      return (explicitMarker && consentText) || (customConsentElement && consentText) || (dialogLike && consentText);
    };

    const labelsInside = (region) => uniqueControls
      .filter((control) => composedContains(region, control))
      .map((control) => ({ el: control, label: ownText(control), type: resolvedActionType(control) }))
      .filter((item) => item.type);

    const hasStrongActionCluster = (region) => {
      const types = new Set(labelsInside(region).map((item) => item.type));
      if (types.size >= 2 && (types.has('accept') || types.has('reject'))) return true;

      // Banner existence should not depend on translating button labels.
      // A visible consent-marked dialog/region with multiple semantic controls
      // is enough to detect the interface, while individual actions may remain
      // manual verification if their meaning cannot be established safely.
      if (!consentStructuralMarker(region)) return false;
      const semanticChildren = allElements.filter((el) =>
        el !== region
        && isVisible(el)
        && el.matches?.(semanticControlSelector)
        && composedContains(region, el)
      );
      return semanticChildren.length >= 2;
    };

    const candidates = [];

    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const tag = el.tagName?.toLowerCase() || '';
      const candidateTag = el.matches?.('div, section, aside, dialog, form, [role="dialog"], [role="alertdialog"], [role="region"]')
        || tag.includes('-');
      if (candidateTag && looksLikeConsentRegion(el) && hasStrongActionCluster(el)) candidates.push(el);
    }

    for (const control of uniqueControls) {
      for (const ancestor of composedAncestors(control, 16)) {
        if (!isVisible(ancestor)) continue;
        if (!hasStrongActionCluster(ancestor)) continue;
        if (!looksLikeConsentRegion(ancestor)) continue;
        candidates.push(ancestor);
        break;
      }
    }

    for (const el of allElements) {
      if (!el.shadowRoot || !isVisible(el)) continue;
      if (looksLikeConsentRegion(el) && hasStrongActionCluster(el)) candidates.push(el);
    }

    // Root-level fallback for web components. Some CMPs render their entire
    // interface inside an open shadow root where normal Element.contains()
    // relationships stop at the shadow boundary. A root with multiple explicit
    // consent actions plus cookie/consent context is strong evidence by itself.
    for (const cluster of rootConsentClusters) {
      // A custom-element host may have no box (display: contents) even though
      // its shadow-root buttons are visible. The visible actions are the proof.
      if (cluster.host) candidates.push(cluster.host);
    }

    const dedupedCandidates = [...new Set(candidates)];
    const bannerElements = dedupedCandidates.filter((candidate) =>
      !dedupedCandidates.some((other) =>
        other !== candidate
        && composedContains(candidate, other)
        && hasStrongActionCluster(other)
        && looksLikeConsentRegion(other)
      )
    );

    const isInsideBanner = (el) =>
      dedupedCandidates.some((candidate) => composedContains(candidate, el))
      || rootConsentClusters.some((cluster) => cluster.controls.includes(el));

    const controls = uniqueControls.map((el) => ({
      text: ownText(el).slice(0, 500),
      id: el.id || '',
      cls: String(el.className || '').slice(0, 200),
      href: el.href || '',
      semantic: el.matches?.('button, a, input, [role="button"], [role="menuitem"]') || false,
      insideBanner: isInsideBanner(el),
      action: resolvedActionType(el)
    }));

    const links = allElements
      .filter((el) => el.matches?.('a[href]') && isVisible(el))
      .map((a) => ({ text: ownText(a).slice(0, 500), href: a.href }));

    // Diagnostic-only evidence. Keep this deliberately bounded so logs stay
    // useful without turning scanner_completed into a DOM dump.
    const policyLinkCandidates = links
      .filter((link) => /privacy|cookie|consent|gegevens|datenschutz|confidentialit|privacidad/i.test(link.text + ' ' + link.href))
      .slice(0, 20);

    const consentControlCandidates = allElements
      .filter((el) => isVisible(el) && el.matches?.(semanticControlSelector))
      .map((el) => {
        const ancestorMarker = composedAncestors(el).slice(0, 2).map((ancestor) => markerText(ancestor)).join(' ');
        return {
          text: ownText(el).slice(0, 180),
          tag: el.tagName?.toLowerCase() || '',
          id: el.id || '',
          cls: String(el.className || '').slice(0, 180),
          role: el.getAttribute?.('role') || '',
          ariaLabel: el.getAttribute?.('aria-label') || '',
          title: el.getAttribute?.('title') || '',
          ancestorMarker: ancestorMarker.slice(0, 300)
        };
      })
      .filter((item) => /cookie|consent|privacy|accept|allow|agree|reject|deny|decline|preference|setting|custom|widget|toestaan|aanpassen|instelling|voorkeur|weigern|ablehnen|akzept|einstellung|param[eè]tre|configuraci[oó]n|impostaz|configura[cç][aã]o/i.test(
        [item.text, item.id, item.cls, item.role, item.ariaLabel, item.title, item.ancestorMarker].join(' ')
      ))
      .slice(0, 30);

    // Diagnostic candidates deliberately include hidden controls. These records
    // never participate in classification or scoring. No form values, arbitrary
    // data attributes, URL queries, or full ancestor text are logged here.
    let withdrawalDiagnostics;
    try {
      const short = (value, max = 120) => String(value || '').replace(/\s+/g, ' ').slice(0, max);
      const metadata = (el) => ({
        tag: el.tagName?.toLowerCase() || '',
        id: short(el.id),
        cls: short(typeof el.className === 'string' ? el.className : ''),
        role: short(el.getAttribute('role')),
        ariaLabel: short(el.getAttribute('aria-label')),
        title: short(el.getAttribute('title'))
      });
      const diagnosticCandidates = [];
      let diagnosticCandidateCount = 0;
      for (const el of allElements) {
        if (!el.matches?.(semanticControlSelector)) continue;
        const ancestors = composedAncestors(el);
        const nearby = ancestors.slice(0, 3).filter((a) => !a.matches('body, html'));
        const own = metadata(el);
        const data = Object.fromEntries(['data-action', 'data-testid', 'data-cy', 'data-label']
          .filter((name) => el.hasAttribute(name))
          .map((name) => [name, short(el.getAttribute(name))]));
        const text = short(el.textContent, 120);
        const context = [text, ...Object.values(own), ...Object.values(data),
          ...nearby.flatMap((a) => Object.values(metadata(a)))].join(' ');
        const reasons = [];
        if (regs.bannerMarker.test(context) || regs.settings.test(context)) reasons.push('consent-metadata-or-context');
        if (el.hasAttribute('aria-controls') || el.hasAttribute('aria-haspopup')) reasons.push('controls-or-opens-region');
        const style = getComputedStyle(el);
        if (!text.trim() && [el, ...nearby].some((a) => /^(fixed|sticky)$/.test(getComputedStyle(a).position))) {
          reasons.push('persistent-icon-control');
        }
        if (!reasons.length) continue;
        diagnosticCandidateCount += 1;
        if (diagnosticCandidates.length >= 60) {
          const replaceIndex = diagnosticCandidates.findIndex((c) => c.insideBanner);
          if (isInsideBanner(el) || replaceIndex < 0) continue;
          diagnosticCandidates.splice(replaceIndex, 1);
        }
        const rect = el.getBoundingClientRect();
        const hiddenReasons = [];
        for (const node of [el, ...ancestors]) {
          const s = getComputedStyle(node);
          const prefix = node === el ? 'self:' : 'ancestor:';
          if (s.display === 'none') hiddenReasons.push(prefix + 'display-none');
          if (Number(s.opacity) === 0) hiddenReasons.push(prefix + 'opacity-zero');
          if (s.contentVisibility === 'hidden') hiddenReasons.push(prefix + 'content-visibility-hidden');
        }
        // Visibility is inherited but descendants can override it.
        if (/^(hidden|collapse)$/.test(style.visibility)) hiddenReasons.push('self:visibility-' + style.visibility);
        if (!rect.width || !rect.height) hiddenReasons.push('no-layout-box');
        let href = '';
        try { const u = new URL(el.getAttribute('href'), document.baseURI); if (/^https?:$/.test(u.protocol) && el.hasAttribute('href')) href = short(u.origin + u.pathname, 180); } catch {}
        const path = [el, ...ancestors].slice(0, 12).map((node) =>
          node.tagName.toLowerCase() + ':' + Array.prototype.indexOf.call(node.parentNode?.children || [], node)
        ).join('/');
        diagnosticCandidates.push({
          key: path, ...own, text, href, data,
          ancestors: nearby.map(metadata),
          ariaControls: short(el.getAttribute('aria-controls')),
          insideBanner: isInsideBanner(el),
          visible: hiddenReasons.length === 0,
          detectorVisible: isVisible(el),
          hiddenReasons: [...new Set(hiddenReasons)],
          ariaHidden: [el, ...ancestors].some((a) => a.getAttribute('aria-hidden') === 'true'),
          inert: [el, ...ancestors].some((a) => a.hasAttribute('inert')),
          inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          reasons
        });
      }
      // Prioritize external entry points over banner controls in bounded logs.
      diagnosticCandidates.sort((a, b) => Number(a.insideBanner) - Number(b.insideBanner));
      withdrawalDiagnostics = {
        documentId: String(performance.timeOrigin),
        observedAtMs: Math.round(performance.now()),
        candidateCount: diagnosticCandidateCount,
        truncated: diagnosticCandidateCount > 60,
        candidates: diagnosticCandidates
      };
    } catch {
      withdrawalDiagnostics = { error: 'diagnostic-capture-failed' };
    }

    const bodyText = [
      document.body?.innerText || '',
      ...roots.filter((root) => root instanceof ShadowRoot).map((root) => root.textContent || '')
    ].join('\\n').slice(0, 100000);

    const htmlMarkers = [
      document.documentElement.outerHTML,
      ...allElements.filter((el) => el.shadowRoot).map((el) =>
        '<shadow-host tag="' + (el.tagName?.toLowerCase() || '') + '" id="' + (el.id || '') + '" class="' + String(el.className || '') + '">' +
        (el.shadowRoot?.innerHTML || '') + '</shadow-host>'
      )
    ].join('\\n').slice(0, 500000);

    const preferredControl = (matches) => controls
      .filter(matches)
      .sort((a, b) => Number(b.semantic) - Number(a.semantic) || a.text.length - b.text.length)[0] || null;

    const findBannerControl = (name) => preferredControl((c) => c.insideBanner && c.action === name);

    const findSettingsEntry = () => {
      const direct = preferredControl((c) => !c.insideBanner && regs.settings.test(c.text));
      if (direct) return direct;

      const structural = allElements
        .filter((el) => isVisible(el) && el.matches?.(semanticControlSelector) && !isInsideBanner(el))
        .map((el) => {
          const ancestors = composedAncestors(el).slice(0, 3);
          const nearbyMarker = [markerText(el), ...ancestors.map((ancestor) => markerText(ancestor))]
            .join(' ')
            .toLowerCase();
          return {
            el,
            text: ownText(el).slice(0, 500),
            marker: nearbyMarker
          };
        })
        .filter((item) => {
          const hasConsentContext = /(?:cookie|consent|privacy|gdpr|toestemming|datenschutz|confidentialit|privacidad|privacidade)/i.test(item.marker);
          const hasSettingsIntent = /(?:setting|preference|manage|choice|widget|config|option|instelling|voorkeur|einstellung|param[eè]tre|configuraci[oó]n|impostaz|configura[cç][aã]o)/i.test(item.marker);
          return hasConsentContext && hasSettingsIntent;
        })
        .sort((a, b) => {
          // Prefer controls whose own accessibility/DOM metadata carries the
          // evidence, then shorter labels. Ancestor context is a fallback.
          const aOwn = markerText(a.el);
          const bOwn = markerText(b.el);
          const aDirect = /(?:cookie|consent|privacy|gdpr)/i.test(aOwn) && /(?:setting|preference|manage|choice|widget|config|option)/i.test(aOwn);
          const bDirect = /(?:cookie|consent|privacy|gdpr)/i.test(bOwn) && /(?:setting|preference|manage|choice|widget|config|option)/i.test(bOwn);
          if (aDirect !== bDirect) return aDirect ? -1 : 1;
          return a.text.length - b.text.length;
        })[0];

      if (!structural) return null;
      return {
        text: structural.text,
        id: structural.el.id || '',
        cls: String(structural.el.className || '').slice(0, 200),
        href: structural.el.href || '',
        semantic: true,
        insideBanner: false,
        action: 'settings'
      };
    };

    const policy = (name) => links.find((l) => regs[name].test(l.text + ' ' + l.href));

    if (targetAction) {
      // Interactive targeting is deliberately stricter than passive detection.
      // Never click containers, submit controls, navigational links, or a
      // control whose purpose is inferred from unrelated ancestor page text.
      const actionable = (el) => {
        if (!el.matches?.('button, a, input[type="button"], [role="button"]') || !isVisible(el)) return false;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        if ([el, ...composedAncestors(el)].some((a) => a.hasAttribute('inert') || a.getAttribute('aria-hidden') === 'true'
          || getComputedStyle(a).display === 'none' || Number(getComputedStyle(a).opacity) === 0)) return false;
        if (el.closest?.('form') && (el.tagName === 'BUTTON' && (!el.getAttribute('type') || el.getAttribute('type') === 'submit'))) return false;
        if (el.tagName === 'A') {
          const href = el.getAttribute('href') || '';
          if (href && !href.startsWith('#')) return false;
        }
        return true;
      };
      const targets = allElements.filter((el) => {
        if (!actionable(el)) return false;
        const own = markerText(el);
        if (targetAction === 'accept') {
          return isInsideBanner(el) && resolvedActionType(el) === 'accept'
            && !regs.reject.test(own) && !regs.preferences.test(own)
            && !/got it|necessary only|essential only/i.test(own)
            && /accept|allow|agree|opt.?in|toestaan|accepter|akzept|aceptar|accetta|aceitar/i.test(own);
        }
        if (targetAction !== 'settings' || isInsideBanner(el)) return false;
        const context = [own, ...composedAncestors(el, 2).filter((a) => !a.matches('body, html'))
          .map((a) => [a.id, typeof a.className === 'string' ? a.className : '', a.getAttribute('aria-label')].join(' '))].join(' ');
        return regs.settings.test(own) || (
          /cookie|consent|privacy|gdpr|toestemming|datenschutz|confidentialit|privacidad|privacidade/i.test(context)
          && /setting|preference|manage|choice|widget|config|instelling|voorkeur|einstellung|param[eè]tre|impostaz/i.test(context)
        );
      });
      return targets.length === 1 ? targets[0] : targets.length > 1 ? 'ambiguous' : null;
    }

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
      bannerDetected: bannerElements.length > 0 || rootConsentClusters.length > 0,
      bannerCandidateCount: Math.max(bannerElements.length, rootConsentClusters.length),
      consentRootClusterCount: rootConsentClusters.length,
      htmlMarkers,
      bodyText,
      shadowDomInspected: roots.length > 1,
      shadowRootCount: roots.length - 1,
      consentmoHostPresent: allElements.some((el) => el.matches?.('csm-cookie-consent')),
      bodyTextLength: bodyText.length,
      visibleControlCount: uniqueControls.length,
      consentLikeControlTexts: controls.map((control) => control.text).slice(0, 20),
      policyLinkCandidates,
      consentControlCandidates,
      withdrawalDiagnostics
    };
  }, { regexSources: Object.fromEntries(Object.entries(DOM_REGEX).map(([k, re]) => [k, re.source])), targetAction });
}
