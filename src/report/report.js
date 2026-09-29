import { buildFindings, CORE_AUTOMATED_CHECK_COUNT, CORE_CHECKS } from './buildFindings.js';
import { calculateScore, scoreLabel } from './score.js';

export function createReport(raw) {
  const detection = buildFindings(raw);
  const scoring = calculateScore(detection.findings, CORE_AUTOMATED_CHECK_COUNT);
  const coveragePercent = scoring.coveragePercent;
  const byKey = new Map(detection.findings.map((f) => [f.key, f]));
  const coreChecks = CORE_CHECKS.map(([key, label]) => {
    const f = byKey.get(key);
    const assessed = Boolean(f?.score && Number.isFinite(f.score.max));
    return { key, label, status: assessed ? (f.status === 'concern' ? 'concern' : 'passed') : 'not_assessed',
      reason: assessed ? null : (f?.detected || 'This check could not be scored automatically.') };
  });

  return {
    version: '1.0.4',
    scanType: 'automated-technical-privacy-implementation-check',
    requestedUrl: raw.requestedUrl,
    finalUrl: raw.finalUrl,
    scannedAt: raw.scannedAt,
    scanLocation: raw.scanLocation,
    score: scoring.score,
    observedScore: scoring.observedScore,
    scoreLabel: scoreLabel(scoring.score, coveragePercent),
    scoreCoverage: {
      assessedChecks: scoring.assessedChecks,
      totalCoreChecks: CORE_AUTOMATED_CHECK_COUNT,
      percent: coveragePercent,
      coreChecks,
      unassessedChecks: coreChecks.filter((check) => check.status === 'not_assessed')
    },
    scoreExplanation: scoring.score === null
      ? 'Not enough observable evidence was available to calculate a technical score.'
      : `Observed checks scored ${scoring.observedScore}/100. Automated coverage was ${scoring.assessedChecks}/${CORE_AUTOMATED_CHECK_COUNT} core checks (${coveragePercent}%). Unassessed checks do not reduce the score and are not treated as passes. This is not a legal compliance score.`,
    disclaimer: 'This scanner performs automated technical checks only. It does not provide legal advice and does not determine compliance with any privacy law.',
    summary: {
      passed: detection.findings.filter((f) => f.status === 'passed').length,
      concerns: detection.findings.filter((f) => f.status === 'concern').length,
      observations: detection.findings.filter((f) => f.status === 'observation').length,
      manual: detection.findings.filter((f) => f.status === 'manual').length
    },
    findings: {
      passed: detection.findings.filter((f) => f.status === 'passed'),
      concerns: detection.findings.filter((f) => f.status === 'concern'),
      observations: detection.findings.filter((f) => f.status === 'observation'),
      manual: detection.findings.filter((f) => f.status === 'manual')
    },
    technicalEvidence: {
      postConsent: raw.postConsent || null,
      cmpDetected: detection.cmps.map((cmp) => cmp.name),
      cmpEvidence: detection.cmps.map((cmp) => ({ name: cmp.name, evidence: cmp.evidence })),
      trackerTechnologies: detection.trackers.map((t) => t.name),
      cookieCount: raw.cookies.length,
      localStorageCount: raw.storage.localStorage.length,
      sessionStorageCount: raw.storage.sessionStorage.length,
      thirdPartyDomainCount: raw.thirdPartyDomains.length,
      thirdPartyDomains: raw.thirdPartyDomains.slice(0, 30),
      requestCount: raw.network.length,
      redirectCount: raw.redirectCount,
      shadowDomInspected: Boolean(raw.dom.shadowDomInspected),
      consentModeSignals: detection.consentMode.signals,
      googleTagConsentKeys: raw.runtimeConsent?.googleTagConsentKeys || [],
      dataLayerConsentCommandCount: raw.runtimeConsent?.dataLayerConsentCommands?.length || 0
    },
    limitations: [
      'Whether every tracker respects Reject, Accept, or later consent changes',
      'Actual consent withdrawal and tracking after changed preferences (the scanner may click Accept and test reopening, but does not disable purposes or verify saved changes)',
      'Regional and geolocation-dependent behavior outside the stated scan location',
      'California opt-out and Global Privacy Control (GPC) behavior',
      'Full granular consent-category mapping',
      'Server-side tracking or server-to-server data sharing',
      'Reliable duplicate-event or duplicate-installation diagnosis',
      'Whether the site is legally compliant',
      'Whether any specific privacy law applies to the business',
      'Behavior that only appears after login, checkout, navigation, or extended interaction'
    ]
  };
}
