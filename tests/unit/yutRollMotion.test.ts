import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
} from '../../src/app/flows/yutRollAnimation.js';
import {
  LOCAL_LANDING_IMPACT_PROGRESS,
  LOCAL_THROW_APEX_PROGRESS,
  REMOTE_ROLL_LANDING_START_MS,
  REMOTE_ROLL_LOCAL_TIMELINE_OFFSET_MS,
  getContinuousLandingDropProgress,
  getLandingMotion,
  getPrimaryThrowHeight,
  getRemoteLandingElapsedMs,
} from '../../src/app/flows/yutRollMotion.js';

test('roll animation keeps the existing synchronization durations', () => {
  assert.equal(LOCAL_ROLL_PRIMARY_MS, 1200);
  assert.equal(LOCAL_ROLL_LANDING_MS, 1700);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS, 2900);
  assert.equal(REMOTE_ROLL_PRE_RESULT_MS, 1200);
});

test('remote roll reuses the final 1.2 seconds of the local timeline', () => {
  assert.equal(REMOTE_ROLL_LOCAL_TIMELINE_OFFSET_MS, 1700);
  assert.equal(REMOTE_ROLL_LANDING_START_MS, 500);
  assert.equal(getRemoteLandingElapsedMs(0), 500);
  assert.equal(getRemoteLandingElapsedMs(REMOTE_ROLL_PRE_RESULT_MS), LOCAL_ROLL_LANDING_MS);
});

test('local throw reaches a high apex and is already descending before landing starts', () => {
  const startY = -0.14;
  const apexHeight = getPrimaryThrowHeight(startY, LOCAL_THROW_APEX_PROGRESS, 0);
  const beforeEndHeight = getPrimaryThrowHeight(startY, 0.96, 0);
  const endHeight = getPrimaryThrowHeight(startY, 1, 0);

  assert.ok(apexHeight > 3.3);
  assert.ok(beforeEndHeight > endHeight);
  assert.ok(endHeight > 3);
});

test('landing starts moving immediately and remains monotonic until impact', () => {
  const samples = [0, 0.001, 0.2, 0.5, 0.8, 1].map(getContinuousLandingDropProgress);
  assert.equal(samples[0], 0);
  assert.ok(samples[1] > 0);
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] > samples[index - 1]);
  }
  assert.equal(samples.at(-1), 1);
});

test('landing adds bounce and lateral roll before settling exactly at the target', () => {
  const impact = getLandingMotion(LOCAL_LANDING_IMPACT_PROGRESS, 1);
  const bouncing = getLandingMotion(LOCAL_LANDING_IMPACT_PROGRESS + 0.08, 1);
  const settled = getLandingMotion(1, 1);

  assert.equal(impact.bounceHeight, 0);
  assert.ok(bouncing.bounceHeight > 0);
  assert.notEqual(bouncing.rollOffsetX, 0);
  assert.notEqual(bouncing.rollOffsetZ, 0);
  assert.ok(Math.abs(settled.bounceHeight) < 1e-12);
  assert.equal(settled.slideProgress, 1);
  assert.ok(Math.abs(settled.wobbleRadians) < Number.EPSILON * 4);
});
