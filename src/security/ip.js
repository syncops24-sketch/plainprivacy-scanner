import net from 'node:net';

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0) >>> 0;
}

function inCidr4(ip, base, prefix) {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

export function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (!family) return true;

  if (family === 4) {
    return BLOCKED_IPV4.some(([base, prefix]) => inCidr4(ip, base, prefix));
  }

  const value = ip.toLowerCase();
  // IPv6 loopback, unspecified, link-local, unique-local, multicast and IPv4-mapped private/local.
  if (value === '::' || value === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(value)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(value)) return true; // fe80::/10
  if (/^ff/i.test(value)) return true; // multicast
  if (value.startsWith('2001:db8:')) return true; // documentation

  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);

  return false;
}
