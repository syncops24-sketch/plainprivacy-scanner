import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp } from '../src/security/ip.js';

test('blocks private and local IPv4 ranges', () => {
  for (const ip of ['127.0.0.1','10.2.3.4','172.16.0.1','172.31.255.255','192.168.1.1','169.254.169.254','100.64.0.1']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test('allows ordinary public IPv4', () => {
  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp('1.1.1.1'), false);
});

test('blocks local/private IPv6', () => {
  for (const ip of ['::1','::','fc00::1','fd12::1','fe80::1','ff02::1','2001:db8::1']) assert.equal(isBlockedIp(ip), true, ip);
});
