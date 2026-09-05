import dns from 'node:dns/promises';
import net from 'node:net';
import { isBlockedIp } from './ip.js';

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function parseCandidate(input) {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 2048) {
    throw new UnsafeUrlError('Enter a valid public website URL.');
  }
  const raw = input.trim();
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new UnsafeUrlError('Enter a valid public website URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeUrlError('Only public HTTP and HTTPS URLs can be scanned.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs containing credentials are not accepted.');
  }
  url.hash = '';
  return url;
}

export async function validatePublicUrl(input) {
  const url = input instanceof URL ? new URL(input) : parseCandidate(input);
  const hostname = normalizeHostname(url.hostname);

  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new UnsafeUrlError('Local or internal hosts cannot be scanned.');
  }

  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw new UnsafeUrlError('Private, local, reserved, or metadata addresses cannot be scanned.');
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError('The hostname could not be resolved.');
  }

  if (!records.length || records.some((record) => isBlockedIp(record.address))) {
    throw new UnsafeUrlError('The hostname resolves to a private, local, reserved, or metadata address.');
  }

  return { url, hostname, addresses: records.map((r) => r.address) };
}

export async function assertSafeRequestUrl(urlString) {
  const { url } = await validatePublicUrl(urlString);
  return url;
}
