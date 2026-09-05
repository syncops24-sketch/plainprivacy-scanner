import test from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain, isThirdParty } from '../src/utils/domain.js';

test('uses public suffix data for registrable domains', () => {
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(isThirdParty('https://cdn.example.co.uk/a.js', 'www.example.co.uk'), false);
  assert.equal(isThirdParty('https://tracker.example.net/pixel', 'www.example.co.uk'), true);
});
