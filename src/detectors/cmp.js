import { CMP_PATTERNS } from './patterns.js';

function collectMatches(values, patterns = []) {
  if (!patterns.length) return [];
  return values.filter((value) => patterns.some((pattern) => pattern.test(value))).slice(0, 6);
}

export function detectCmps({ dom, scripts = [], networkUrls = [] }) {
  const html = dom?.htmlMarkers || '';
  const detected = [];

  for (const cmp of CMP_PATTERNS) {
    const networkEvidence = collectMatches(networkUrls, cmp.networkPatterns);
    const scriptEvidence = collectMatches(scripts, cmp.scriptPatterns);
    const domEvidence = (cmp.domPatterns || []).filter((pattern) => pattern.test(html)).map((pattern) => `DOM signature: ${pattern.source}`).slice(0, 3);

    // Avoid matching a vendor merely because its name appears in page copy.
    // A CMP requires executable/network evidence or a vendor-specific DOM signature.
    if (networkEvidence.length || scriptEvidence.length || domEvidence.length) {
      detected.push({
        name: cmp.name,
        evidence: [...networkEvidence, ...scriptEvidence, ...domEvidence].slice(0, 6)
      });
    }
  }

  return detected;
}
