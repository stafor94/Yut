import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  getLocalLandingDropProgress,
  getYutRollPreResultDurationMs,
} from '../../src/app/flows/yutRollAnimation.js';
import {
  getYutRollFallTarget,
  getYutRollMatWorldBounds,
  getYutRollSceneFraming,
} from '../../src/app/flows/yutRollSceneLayout.js';

test('local player roll extends the landing by 0.7 seconds', () => {
  assert.equal(LOCAL_ROLL_PRIMARY_MS, 1200);
  assert.equal(LOCAL_ROLL_LANDING_MS, 1700);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS, 2900);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS - REMOTE_ROLL_PRE_RESULT_MS, 1700);
});

test('local landing starts moving immediately and accelerates continuously', () => {
  assert.equal(getLocalLandingDropProgress(0), 0);
  assert.ok(getLocalLandingDropProgress(0.05) > 0);
  assert.ok(getLocalLandingDropProgress(0.1) < getLocalLandingDropProgress(0.5));
  assert.ok(getLocalLandingDropProgress(0.5) < getLocalLandingDropProgress(0.9));
  assert.equal(getLocalLandingDropProgress(1), 1);
});

test('pending phases use the local timeline and resolved rolls use the remote timeline', () => {
  assert.equal(getYutRollPreResultDurationMs('primary'), 2900);
  assert.equal(getYutRollPreResultDurationMs('landing'), 2900);
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

test('visible mat pixel bounds map to matching Three.js ground bounds', () => {
  const compactMat = getYutRollMatWorldBounds(388, 330, 72, 316);
  const wideMat = getYutRollMatWorldBounds(388, 330, 24, 364);

  assert.ok(compactMat.leftX < 0);
  assert.ok(compactMat.rightX > 0);
  assert.ok(compactMat.rightX - compactMat.leftX < wideMat.rightX - wideMat.leftX);
  assert.equal(compactMat.targetZ, -0.18);
});

test('fall targets clear the actual mat edge and drop below its ground plane', () => {
  const bounds = getYutRollMatWorldBounds(388, 330, 72, 316);
  const targets = Array.from({ length: 4 }, (_, index) => getYutRollFallTarget(index, bounds));

  targets.forEach((target, index) => {
    if (index % 2 === 0) {
      assert.equal(target.side, -1);
      assert.ok(target.x <= bounds.leftX - 0.92);
    } else {
      assert.equal(target.side, 1);
      assert.ok(target.x >= bounds.rightX + 0.92);
    }
    assert.ok(target.y < 0);
  });

  assert.notEqual(targets[0].z, targets[2].z);
  assert.notEqual(targets[1].z, targets[3].z);
});
