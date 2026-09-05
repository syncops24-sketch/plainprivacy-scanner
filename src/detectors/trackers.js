import { POTENTIAL_NONESSENTIAL_COOKIE_PATTERNS, TRACKERS } from './patterns.js';

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => pattern.test(value));
}

export function detectTrackers({ network = [], networkUrls = [], scripts, cookies }) {
  const networkEntries = network.length ? network : networkUrls.map((url) => ({ url, type: 'unknown', method: 'GET', postDataPreview: '' }));
  const urls = [...networkUrls, ...scripts];
  const detected = [];

  for (const tracker of TRACKERS) {
    const urlEvidence = urls.filter((url) => matchesAny(url, tracker.urlPatterns)).slice(0, 8);
    const networkEvidence = networkEntries
      .filter((entry) => matchesAny(entry.url, tracker.urlPatterns))
      .slice(0, 12);
    const collectionEvidence = networkEvidence
      .filter((entry) => matchesAny(entry.url, tracker.collectionPatterns || []))
      .slice(0, 8);
    const libraryEvidence = networkEvidence
      .filter((entry) => !matchesAny(entry.url, tracker.collectionPatterns || []))
      .slice(0, 8);
    const cookieEvidence = cookies
      .filter((cookie) => matchesAny(cookie.name, tracker.cookiePatterns))
      .map((c) => c.name)
      .slice(0, 8);

    if (urlEvidence.length || cookieEvidence.length) {
      detected.push({
        ...tracker,
        urlEvidence,
        networkEvidence,
        collectionEvidence,
        libraryEvidence,
        cookieEvidence
      });
    }
  }

  return detected;
}

export function detectPotentialNonessentialCookies(cookies) {
  return cookies.filter((cookie) => POTENTIAL_NONESSENTIAL_COOKIE_PATTERNS.some((p) => p.test(cookie.name)));
}

export function classifyPreInteractionTrackerTraffic(raw, trackers) {
  const strongConcerns = [];
  const googleSignals = [];
  const otherSignals = [];
  const librarySignals = [];

  const rawNetwork = raw.network?.length ? raw.network : (raw.networkUrls || []).map((url) => ({ url, type: 'unknown', method: 'GET', postDataPreview: '' }));

  for (const tracker of trackers) {
    const networkEvidence = tracker.networkEvidence?.length ? tracker.networkEvidence : rawNetwork.filter((entry) => matchesAny(entry.url, tracker.urlPatterns));
    if (!networkEvidence.length) continue;

    const collectionEvidence = tracker.collectionEvidence || networkEvidence.filter((entry) => matchesAny(entry.url, tracker.collectionPatterns || []));
    const nonCollectionEvidence = networkEvidence.filter((entry) => !collectionEvidence.some((candidate) => candidate.url === entry.url));

    if (['meta_pixel', 'tiktok', 'linkedin', 'pinterest'].includes(tracker.id)) {
      if (collectionEvidence.length) {
        strongConcerns.push({ name: tracker.name, evidence: collectionEvidence.map((entry) => entry.url).slice(0, 3) });
      }
      if (nonCollectionEvidence.length) {
        librarySignals.push({ name: tracker.name, evidence: nonCollectionEvidence.map((entry) => entry.url).slice(0, 3) });
      }
      continue;
    }

    if (['ga4', 'google_ads'].includes(tracker.id)) {
      if (collectionEvidence.length) {
        const collectionUrls = collectionEvidence.map((entry) => entry.url);
        const hasConsentSignal = collectionUrls.some((url) => /[?&](?:gcs|gcd|pscdl)=/i.test(url));
        const hasKnownCookie = tracker.cookieEvidence.length > 0;
        if (hasKnownCookie && !hasConsentSignal) {
          strongConcerns.push({ name: tracker.name, evidence: collectionUrls.slice(0, 3) });
        } else {
          googleSignals.push({ name: tracker.name, evidence: collectionUrls.slice(0, 3), hasConsentSignal });
        }
      }
      if (nonCollectionEvidence.length) {
        librarySignals.push({ name: tracker.name, evidence: nonCollectionEvidence.map((entry) => entry.url).slice(0, 3) });
      }
      continue;
    }

    if (['analytics', 'marketing'].includes(tracker.category)) {
      // For integrations without explicit collection endpoint rules, treat non-script
      // requests as signals needing interpretation. Script/library loads remain observations.
      const eventLike = collectionEvidence.length
        ? collectionEvidence
        : networkEvidence.filter((entry) => entry.type !== 'script');
      const scriptLike = networkEvidence.filter((entry) => entry.type === 'script');

      if (eventLike.length) {
        otherSignals.push({ name: tracker.name, evidence: eventLike.map((entry) => entry.url).slice(0, 3) });
      }
      if (scriptLike.length) {
        librarySignals.push({ name: tracker.name, evidence: scriptLike.map((entry) => entry.url).slice(0, 3) });
      }
    }
  }

  return { strongConcerns, googleSignals, otherSignals, librarySignals };
}
