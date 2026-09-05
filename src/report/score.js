export function calculateScore(findings, totalCoreChecks = 12) {
  const scored = findings.filter((item) => item.score && item.score.max > 0);
  const earned = scored.reduce((sum, item) => sum + item.score.earned, 0);
  const possible = scored.reduce((sum, item) => sum + item.score.max, 0);
  const observedScore = possible > 0 ? Math.round((earned / possible) * 100) : null;
  const assessedChecks = scored.length;
  const coverage = totalCoreChecks > 0 ? Math.min(1, assessedChecks / totalCoreChecks) : 0;

  // Unassessed checks are treated as neutral (50/100), not as passes or failures.
  // This prevents partial scans from displaying a misleading 100/100 headline score.
  const score = observedScore === null
    ? null
    : Math.round((observedScore * coverage) + (50 * (1 - coverage)));

  return {
    score,
    observedScore,
    earned,
    possible,
    assessedChecks,
    coveragePercent: Math.round(coverage * 100)
  };
}

export function scoreLabel(score, coveragePercent) {
  if (score === null) return 'Insufficient automated evidence';
  const suffix = coveragePercent < 80 ? ' · partial automated coverage' : '';
  if (score >= 85) return `Strong observed signals${suffix}`;
  if (score >= 70) return `Generally positive observed signals${suffix}`;
  if (score >= 50) return `Mixed observed signals${suffix}`;
  if (score >= 30) return `Several implementation concerns${suffix}`;
  return `Significant technical concerns detected${suffix}`;
}
