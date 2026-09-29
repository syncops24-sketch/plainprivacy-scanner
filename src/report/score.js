export function calculateScore(findings, totalCoreChecks = 12) {
  const scored = findings.filter((item) => item.score && item.score.max > 0);
  const earned = scored.reduce((sum, item) => sum + item.score.earned, 0);
  const possible = scored.reduce((sum, item) => sum + item.score.max, 0);
  const observedScore = possible > 0 ? Math.round((earned / possible) * 100) : null;
  const assessedChecks = scored.length;
  const coverage = totalCoreChecks > 0 ? Math.min(1, assessedChecks / totalCoreChecks) : 0;

  // Headline score reflects only checks the scanner could actually assess.
  // Coverage is reported separately so unknown checks never look like failures.
  // Headline score intentionally treats unassessed/manual core checks as zero points.
  // This keeps the score conservative while coverage explains what automation could verify.
  const score = observedScore === null ? null : Math.round(observedScore * coverage);

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
  if (score >= 85) return 'Strong observed signals';
  if (score >= 70) return 'Generally positive observed signals';
  if (score >= 50) return 'Mixed observed signals';
  if (score >= 30) return 'Several implementation concerns';
  return 'Significant technical concerns detected';
}
