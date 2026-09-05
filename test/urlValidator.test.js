import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicUrl, UnsafeUrlError } from '../src/security/urlValidator.js';

test('rejects non-http schemes before DNS resolution', async () => {
  await assert.rejects(() => validatePublicUrl('file:///etc/passwd'), UnsafeUrlError);
});

test('rejects localhost', async () => {
  await assert.rejects(() => validatePublicUrl('http://localhost:3000'), UnsafeUrlError);
});

test('rejects direct private IPs', async () => {
  await assert.rejects(() => validatePublicUrl('http://192.168.1.1'), UnsafeUrlError);
});
