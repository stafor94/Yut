import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
} from '../../src/app/flows/yutRollAnimation.js';
import {
  EXTRA_SPIN_RADIANS_PER_SECOND_BASE,
  EXTRA_SPIN_RADIANS_PER_SECOND_STEP,
  LANDING_FLIGHT_SPIN_TURNS_BASE,
  LANDING_FLIGHT_SPIN_TURNS_STEP,
  LOCAL_LANDING_IMPACT_PROGRESS,
  LOCAL_THROW_APEX_PROGRESS,
  MAX_TOTAL_SPIN_TURNS,
  PRIMARY_SPIN_TURNS_BASE,
  PRIMARY_SPIN_TURNS_STEP,
  REMOTE_ROLL_LANDING_START_MS,
  REMOTE_ROLL_LOCAL_TIMELINE_START_MS,
  getContinuousLandingDropProgress,
  getLandingMotion,
  getPrimaryHorizontalProgress,
  getPrimaryThrowHeight,
  getRemoteLandingElapsedMs,
  getRemoteTimelineElapsedMs,
} from '../../src/app/flows/yutRollMotion.js';
import { getYutRollSceneFraming } from '../../src/app/flows/yutRollSceneLayout.js';

test('roll animation keeps the existing synchronization durations', () => {
  assert.equal(LOCAL_ROLL_PRIMARY_MS, 1200);
  assert.equal(LOCAL_ROLL_LANDING_MS, 1700);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS, 2900);
  assert.equal(REMOTE_ROLL_PRE_RESULT_MS, 1200);
});

test('remote roll maps the second half of the local timeline to its existing duration', () => {
  assert.equal(REMOTE_ROLL_LOCAL_TIMELINE_START_MS, LOCAL_ROLL_PRE_RESULT_MS / 2);
  assert.equal(REMOTE_ROLL_LANDING_START_MS, 250);
  assert.equal(getRemoteTimelineElapsedMs(0), LOCAL_ROLL_PRE_RESULT_MS / 2);
  assert.equal(getRemoteTimelineElapsedMs(REMOTE_ROLL_PRE_RESULT_MS), LOCAL_ROLL_PRE_RESULT_MS);
  assert.equal(getRemoteLandingElapsedMs(0), 250);
  assert.equal(getRemoteLandingElapsedMs(REMOTE_ROLL_PRE_RESULT_MS), LOCAL_ROLL_LANDING_MS);
});

test('local throw reaches an earlier and visibly higher apex before descending', () => {
  const startY = -0.14;
  const apexHeight = getPrimaryThrowHeight(startY, LOCAL_THROW_APEX_PROGRESS, 0);
  const lateHeight = getPrimaryThrowHeight(startY, 0.82, 0);
  const endHeight = getPrimaryThrowHeight(startY, 1, 0);

  assert.ok(LOCAL_THROW_APEX_PROGRESS < 0.5);
  assert.ok(apexHeight > 4);
  assert.ok(lateHeight < apexHeight);
  assert.ok(endHeight < lateHeight);
  assert.ok(endHeight > 2.4);
});

test('primary horizontal motion does not stop at the phase boundary', () => {
  const beforeEnd = getPrimaryHorizontalProgress(0.99);
  const end = getPrimaryHorizontalProgress(1);
  assert.ok(end > beforeEnd);
  assert.ok(end - beforeEnd > 0.01);
});

test('landing starts immediately, accelerates into an earlier impact, and remains monotonic', () => {
  const samples = [0, 0.001, 0.2, 0.5, 0.8, 1].map(getContinuousLandingDropProgress);
  assert.equal(samples[0], 0);
  assert.ok(samples[1] > 0);
  assert.ok(samples[1] > 0.0008);
  for (let index = 1; index < samples.length; index += 1) assert.ok(samples[index] > samples[index - 1]);
  assert.equal(samples[samples.length - 1], 1);
  assert.ok(LOCAL_LANDING_IMPACT_PROGRESS <= 0.4);
});

test('landing dedicates more time to two visible bounces before settling exactly', () => {
  const impact = getLandingMotion(LOCAL_LANDING_IMPACT_PROGRESS, 1);
  const firstBounce = getLandingMotion(LOCAL_LANDING_IMPACT_PROGRESS + 0.1, 1);
  const lateBounce = getLandingMotion(0.85, 1);
  const settled = getLandingMotion(1, 1);

  assert.equal(impact.bounceHeight, 0);
  assert.ok(firstBounce.bounceHeight > 0.25);
  assert.ok(lateBounce.bounceHeight > 0.05);
  assert.ok(Math.abs(firstBounce.rollOffsetX) >= 0.22);
  assert.ok(Math.abs(firstBounce.rollOffsetZ) >= 0.09);
  assert.ok(Math.abs(settled.bounceHeight) < 1e-12);
  assert.equal(settled.slideProgress, 1);
  assert.ok(Math.abs(settled.wobbleRadians) < Number.EPSILON * 4);
});

test('each stick stays below the three-turn rotation cap', () => {
  assert.equal(MAX_TOTAL_SPIN_TURNS, 3);
  assert.equal(EXTRA_SPIN_RADIANS_PER_SECOND_BASE, 0);
  assert.equal(EXTRA_SPIN_RADIANS_PER_SECOND_STEP, 0);

  for (let index = 0; index < 4; index += 1) {
    const totalTurns = PRIMARY_SPIN_TURNS_BASE
      + index * PRIMARY_SPIN_TURNS_STEP
      + LANDING_FLIGHT_SPIN_TURNS_BASE
      + index * LANDING_FLIGHT_SPIN_TURNS_STEP;
    assert.ok(totalTurns <= MAX_TOTAL_SPIN_TURNS);
  }
});

test('camera framing raises the look target so the taller apex stays visible', () => {
  const framing = getYutRollSceneFraming(620, 430);
  assert.ok(framing.targetY >= 1.4);
  assert.ok(framing.cameraY > framing.targetY);
});
