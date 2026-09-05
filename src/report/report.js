import { buildFindings, CORE_AUTOMATED_CHECK_COUNT } from './buildFindings.js';
import { calculateScore, scoreLabel } from './score.js';

export function createReport(raw) {
  const detection = buildFindings(raw);
  const scoring = calculateScore(detection.findings, CORE_AUTOMATED_CHECK_COUNT);
  const coveragePercent = scoring.coveragePercent;

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
      percent: coveragePercent
    },
    scoreExplanation: scoring.score === null
      ? 'Not enough observable evidence was available to calculate a technical score.'
      : `Observed checks scored ${scoring.observedScore}/100. The headline score adjusts unassessed coverage toward a neutral baseline, so unknown checks are not treated as passes or failures. This is not a legal compliance score.`,
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
      'Consent withdrawal after a prior choice (a settings entry point can be detected, but The automated scanner does not click it)',
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
