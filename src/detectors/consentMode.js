export function detectConsentMode(raw) {
  const networkStrings = (raw.network || []).map((item) => `${item.url || ''} ${item.postDataPreview || ''}`).join('\n');
  const html = `${raw.dom?.htmlMarkers || ''}\n${raw.dom?.bodyText || ''}`;
  const runtime = raw.runtimeConsent || {};

  const signals = [];
  if (/[?&]gcs=/i.test(networkStrings)) signals.push('Google request contains a gcs consent-related parameter');
  if (/[?&]gcd=/i.test(networkStrings)) signals.push('Google request contains a gcd consent-related parameter');
  if (/[?&]pscdl=/i.test(networkStrings)) signals.push('Google request contains a pscdl consent-related parameter');
  if (/ad_user_data|ad_personalization|analytics_storage|ad_storage/i.test(html)) signals.push('Google consent storage keys are referenced in page code');
  if (/gtag\s*\(\s*['"]consent['"]\s*,\s*['"](?:default|update)['"]/i.test(html)) signals.push('A gtag consent command is visible in page code');
  if (runtime.hasGoogleTagConsentState) signals.push('Google tag runtime exposes consent-state data');
  if ((runtime.dataLayerConsentCommands || []).length) signals.push(`Runtime dataLayer contains ${runtime.dataLayerConsentCommands.length} consent command(s)`);

  const unique = [...new Set(signals)];
  const high = /[?&](?:gcs|gcd|pscdl)=/i.test(networkStrings) || runtime.hasGoogleTagConsentState || (runtime.dataLayerConsentCommands || []).length > 0;

  return {
    detected: unique.length > 0,
    signals: unique,
    confidence: high ? 'High' : unique.length ? 'Medium' : 'Low'
  };
}
