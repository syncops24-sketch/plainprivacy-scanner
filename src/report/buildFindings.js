import { detectCmps } from '../detectors/cmp.js';
import { detectConsentMode } from '../detectors/consentMode.js';
import { classifyPreInteractionTrackerTraffic, detectPotentialNonessentialCookies, detectTrackers } from '../detectors/trackers.js';

function finding(status, title, detected, why, confidence, key, score = null) {
  return { status, title, detected, why, confidence, key, score };
}

const passScore = (max) => ({ earned: max, max });
const concernScore = (max) => ({ earned: 0, max });

export const CORE_AUTOMATED_CHECK_COUNT = 12;

export function buildFindings(raw) {
  const findings = [];
  const cmps = detectCmps(raw);
  const trackers = detectTrackers(raw);
  const potentialCookies = detectPotentialNonessentialCookies(raw.cookies);
  const consentMode = detectConsentMode(raw);
  const traffic = classifyPreInteractionTrackerTraffic(raw, trackers);
  const c = raw.dom.controls;

  if (raw.dom.bannerDetected) {
    findings.push(finding('passed', 'Consent interface detected', 'A visible cookie/consent interface was detected on initial load.', 'This is an observable implementation signal. The automated scan does not prove that the interface behaves correctly after interaction.', 'Medium', 'banner', passScore(2)));
  } else {
    findings.push(finding('manual', 'Consent interface not confidently detected', 'No visible cookie/consent interface was confidently identified during the automated scan.', 'Regional rules, delayed rendering, iframes, custom UI, or a genuinely absent banner can all produce this result. It is not scored as a pass or failure.', 'Medium', 'banner'));
  }

  for (const [key, label, max] of [['accept','Accept control',1], ['reject','Reject control',2], ['preferences','Preferences control',1]]) {
    if (c[key]) findings.push(finding('passed', `${label} detected`, `Visible banner control: “${c[key].text}”.`, 'The control was detected inside the likely consent interface rather than by matching an unrelated page button.', 'High', key, passScore(max)));
    else findings.push(finding('manual', `${label} needs manual verification`, 'No matching control was confidently detected inside the consent interface.', 'Wording, region rules, iframes, custom components, or shadow DOM behavior can make automated detection incomplete.', 'Medium', key));
  }

  if (c.settingsEntry) {
    findings.push(finding('passed', 'Cookie/privacy settings entry point detected', `Visible page control outside the initial banner: “${c.settingsEntry.text}”.`, 'This is evidence of a page-level entry point for privacy preferences. The automated scanner does not click it and therefore does not prove that consent can actually be withdrawn after a prior choice.', 'High', 'settings_entry', passScore(2)));
  } else {
    findings.push(finding('manual', 'Consent withdrawal requires manual verification', 'No separate cookie/privacy settings entry point was confidently detected outside the initial consent interface.', 'The control may be injected later, hidden in a widget, appear only after a choice, or use wording the scanner cannot classify safely.', 'Medium', 'settings_entry'));
  }

  if (raw.dom.policies.privacy) findings.push(finding('passed', 'Privacy Policy link detected', `Link: ${raw.dom.policies.privacy.href}`, 'A visible policy link is a useful documentation signal.', 'High', 'privacy_policy', passScore(1)));
  else findings.push(finding('manual', 'Privacy Policy link not confidently detected', 'No visible link matching common Privacy Policy wording was found.', 'The policy may use different wording or be available elsewhere. This result is not a legal conclusion.', 'Medium', 'privacy_policy'));

  if (raw.dom.policies.cookie) findings.push(finding('passed', 'Cookie Policy link detected', `Link: ${raw.dom.policies.cookie.href}`, 'A cookie-specific document can support transparency about storage and tracking technologies.', 'High', 'cookie_policy', passScore(1)));
  else findings.push(finding('manual', 'Cookie Policy link not confidently detected', 'No visible Cookie Policy/Cookie Notice link was found.', 'Some sites combine cookie information into another policy. This result is not a legal conclusion.', 'Medium', 'cookie_policy'));

  if (cmps.length) findings.push(finding('passed', 'CMP technology detected', cmps.map((cmp) => cmp.name).join(', '), 'Identifying the consent platform helps narrow down configuration and implementation checks.', 'High', 'cmp', passScore(1)));
  else findings.push(finding('manual', 'CMP technology not identified', 'No known CMP signature matched the DOM, scripts, or network requests.', 'The site may use a custom CMP, uncommon vendor, iframe implementation, or no CMP.', 'Medium', 'cmp'));

  const named = new Map(trackers.map((t) => [t.id, t]));
  for (const [id, label] of [['gtm','Google Tag Manager'], ['ga4','Google Analytics 4'], ['google_ads','Google Ads tracking'], ['meta_pixel','Meta Pixel']]) {
    const hit = named.get(id);
    if (hit) findings.push(finding('observation', `${label} detected`, [...hit.urlEvidence, ...hit.cookieEvidence].slice(0,3).join(' | '), 'Detection confirms the technology is present, not that it is incorrectly configured or consent-gated.', 'High', id));
  }

  const otherTrackers = trackers.filter((t) => !['gtm','ga4','google_ads','meta_pixel'].includes(t.id));
  if (otherTrackers.length) findings.push(finding('observation', 'Other tracker technologies detected', otherTrackers.map((t) => t.name).join(', '), 'These integrations may require purpose-based classification and consent-behavior testing.', 'High', 'other_trackers'));

  if (potentialCookies.length) {
    findings.push(finding('concern', 'Potential analytics/marketing cookies present before interaction', potentialCookies.map((cookie) => cookie.name).slice(0,12).join(', '), 'These names commonly belong to analytics or advertising tools and were visible before the scanner interacted with the consent UI.', 'High', 'preconsent_cookies', concernScore(4)));
  } else {
    findings.push(finding('passed', 'No common analytics/marketing cookie names detected before interaction', `${raw.cookies.length} total cookie(s) observed; none matched the scanner’s high-confidence analytics/marketing patterns.`, 'This is a positive initial-load signal, but unknown cookie names still require classification.', 'Medium', 'preconsent_cookies', passScore(4)));
  }

  if (traffic.librarySignals.length) {
    findings.push(finding('observation', 'Tracker library/resource loaded before interaction', traffic.librarySignals.map((x) => `${x.name}: ${x.evidence[0]}`).join(' | '), 'Loading a tracker library or configuration resource confirms the technology is present, but does not by itself prove that a tracking event or collection request was sent.', 'High', 'preconsent_libraries'));
  }

  if (traffic.strongConcerns.length) {
    findings.push(finding('concern', 'Potential analytics/advertising collection activity before interaction', traffic.strongConcerns.map((x) => `${x.name}: ${x.evidence[0]}`).join(' | '), 'A recognizable analytics/advertising event or collection endpoint was contacted before the scanner made a consent choice. Manual review is still needed to understand configuration and legal significance.', 'Medium', 'preconsent_network', concernScore(4)));
  } else if (traffic.googleSignals.length || traffic.otherSignals.length) {
    const detail = [...traffic.googleSignals, ...traffic.otherSignals].map((x) => x.name).join(', ');
    findings.push(finding('manual', 'Pre-interaction tracker requests need interpretation', detail, 'Some tracker-related requests were observed, but the automated scanner cannot safely treat every request as a concern. Google denied-state Consent Mode pings are a key example.', 'Medium', 'preconsent_network'));
  } else {
    findings.push(finding('passed', 'No high-confidence advertising/analytics collection endpoint flagged before interaction', 'No pre-interaction request matched the scanner’s conservative high-confidence concern rules.', 'This reduces obvious initial-load tracking concerns, but does not prove that every data flow is consent-safe.', 'Medium', 'preconsent_network', passScore(4)));
  }

  if (raw.cookies.length) findings.push(finding('observation', 'Initial cookie(s) require classification', raw.cookies.map((cookie) => cookie.name).slice(0,15).join(', '), 'Initial cookies can be necessary, functional, analytics-related, marketing-related, or consent-related. Their presence alone is not a concern; purpose and consent behavior matter.', 'High', 'all_cookies'));
  else findings.push(finding('passed', 'No cookies observed on initial load', 'The clean browser context contained no cookies after the initial observation window.', 'This is a positive storage signal, although other storage mechanisms may still exist.', 'High', 'all_cookies'));

  const storageCount = raw.storage.localStorage.length + raw.storage.sessionStorage.length;
  if (storageCount) findings.push(finding('observation', 'Pre-interaction browser storage requires classification', `${raw.storage.localStorage.length} localStorage and ${raw.storage.sessionStorage.length} sessionStorage key(s) detected.`, 'Browser storage can support necessary, functional, consent, analytics, or marketing purposes. Presence alone does not establish a problem.', 'High', 'storage'));
  else findings.push(finding('passed', 'No localStorage/sessionStorage entries observed', 'No browser storage keys were present after the initial observation window.', 'This is a positive initial-load storage signal.', 'High', 'storage', passScore(1)));

  if (raw.thirdPartyDomains.length) findings.push(finding('observation', 'Pre-interaction third-party requests require classification', raw.thirdPartyDomains.slice(0,20).join(', '), 'Third-party requests can be infrastructure, CMP, CDN, analytics, marketing, or other services. Their purpose and consent state must be interpreted before treating them as a concern.', 'High', 'third_party'));
  else findings.push(finding('passed', 'No third-party domains observed before interaction', 'All observed requests stayed on the scanned site’s registrable domain.', 'Fewer third-party requests make the initial-load data flow easier to reason about.', 'Medium', 'third_party', passScore(1)));

  if (consentMode.detected) findings.push(finding('observation', 'Google Consent Mode-related signal detected', consentMode.signals.join(' | '), 'Presence confirms a consent-related Google signal, but the scanner does not decode or judge the correctness of the consent state.', consentMode.confidence, 'consent_mode'));
  else findings.push(finding('manual', 'Google Consent Mode not confidently detected', 'No clear Consent Mode-related network or code signal was identified.', 'Consent Mode may be absent, hidden in GTM, loaded later, or not applicable when Google tags are not used.', 'Low', 'consent_mode'));

  findings.push(finding('manual', 'Duplicate tracking requires event-level verification', 'The automated scanner does not infer duplicate installation merely because the same tracking ID appears in multiple requests.', 'Normal analytics and advertising tools send repeated requests. Reliable duplicate detection requires comparing event signatures, installation sources, and user actions.', 'High', 'duplicates'));

  return { findings, cmps, trackers, consentMode, potentialCookies, traffic };
}
