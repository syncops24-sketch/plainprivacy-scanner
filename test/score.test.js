import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore } from '../src/report/score.js';

test('manual/unknown findings do not count as passes and partial coverage is neutral-adjusted', () => {
  const result = calculateScore([
    { status:'manual', score:null },
    { status:'passed', score:{ earned:2, max:2 } },
    { status:'concern', score:{ earned:0, max:4 } }
  ], 4);
  assert.equal(result.assessedChecks, 2);
  assert.equal(result.observedScore, 33);
  assert.equal(result.coveragePercent, 50);
  assert.equal(result.score, 42);
});

test('perfect observed checks do not display 100 when coverage is partial', () => {
  const findings = Array.from({ length: 8 }, () => ({ status:'passed', score:{ earned:1, max:1 } }));
  const result = calculateScore(findings, 12);
  assert.equal(result.observedScore, 100);
  assert.equal(result.coveragePercent, 67);
  assert.equal(result.score, 83);
});
