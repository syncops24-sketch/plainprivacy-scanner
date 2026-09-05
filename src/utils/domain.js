import { getDomain } from 'tldts';

export function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function registrableDomain(hostname) {
  const h = normalizeHostname(hostname);
  return getDomain(h, { allowPrivateDomains: true }) || h;
}

export function isThirdParty(urlString, firstPartyHostname) {
  try {
    const host = new URL(urlString).hostname;
    return registrableDomain(host) !== registrableDomain(firstPartyHostname);
  } catch {
    return false;
  }
}
