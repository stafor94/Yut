import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  getYutRollPreResultDurationMs,
} from '../../src/app/flows/yutRollAnimation.js';
import { getYutRollSceneFraming } from '../../src/app/flows/yutRollSceneLayout.js';

test('local player roll keeps the pre-result animation one second longer', () => {
  assert.equal(LOCAL_ROLL_PRIMARY_MS, 1200);
  assert.equal(LOCAL_ROLL_LANDING_MS, 1000);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS, 2200);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS - REMOTE_ROLL_PRE_RESULT_MS, 1000);
});

test('pending phases use the local timeline and resolved rolls use the remote timeline', () => {
  assert.equal(getYutRollPreResultDurationMs('primary'), 2200);
  assert.equal(getYutRollPreResultDurationMs('landing'), 2200);
  assert.equal(getYutRollPreResultDurationMs('resolved'), 1200);
  assert.equal(getYutRollPreResultDurationMs(undefined), 1200);
});

test('narrow mobile scenes move the camera back without distorting the canvas aspect', () => {
  const mobile = getYutRollSceneFraming(388, 340);
  const desktop = getYutRollSceneFraming(620, 410);

  assert.equal(mobile.aspect, 388 / 340);
  assert.equal(desktop.aspect, 620 / 410);
  assert.ok(mobile.distanceScale > desktop.distanceScale);
  assert.ok(mobile.cameraY > desktop.cameraY);
  assert.ok(mobile.cameraZ > desktop.cameraZ);
});

test('scene framing normalizes invalid viewport dimensions', () => {
  const framing = getYutRollSceneFraming(Number.NaN, 0);
  assert.equal(framing.aspect, 1);
  assert.ok(Number.isFinite(framing.cameraY));
  assert.ok(Number.isFinite(framing.cameraZ));
});
