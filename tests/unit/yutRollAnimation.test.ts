import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  ROLL_INTRO_EXTENSION_MS,
  getLocalLandingDropProgress,
  getYutRollPreResultDurationMs,
  isTerminalLiveRollPhase,
} from '../../src/app/flows/yutRollAnimation.js';
import {
  getYutRollFallTarget,
  getYutRollLandingProfile,
  getYutRollLandingTarget,
  getYutRollMatWorldBounds,
  getYutRollSceneFraming,
} from '../../src/app/flows/yutRollSceneLayout.js';

const getLandingTargets = (zone: 'perfect' | 'nice' | 'good' | 'bad' | 'normal') => (
  Array.from({ length: 4 }, (_, index) => getYutRollLandingTarget(index, zone))
);
const getCenterX = (targets: ReturnType<typeof getLandingTargets>) => (
  targets.reduce((sum, target) => sum + target.x, 0) / targets.length
);
const getHorizontalSpread = (targets: ReturnType<typeof getLandingTargets>) => (
  Math.max(...targets.map((target) => target.x)) - Math.min(...targets.map((target) => target.x))
);
const getDepthSpread = (targets: ReturnType<typeof getLandingTargets>) => (
  Math.max(...targets.map((target) => target.z)) - Math.min(...targets.map((target) => target.z))
);

test('local and remote roll intros are extended by one second', () => {
  assert.equal(ROLL_INTRO_EXTENSION_MS, 1000);
  assert.equal(LOCAL_ROLL_PRIMARY_MS, 2200);
  assert.equal(REMOTE_ROLL_PRE_RESULT_MS, 2200);
  assert.equal(LOCAL_ROLL_PRIMARY_MS - ROLL_INTRO_EXTENSION_MS, 1200);
  assert.equal(REMOTE_ROLL_PRE_RESULT_MS - ROLL_INTRO_EXTENSION_MS, 1200);
  assert.equal(LOCAL_ROLL_LANDING_MS, 1700);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS, 3900);
  assert.equal(LOCAL_ROLL_PRE_RESULT_MS - REMOTE_ROLL_PRE_RESULT_MS, LOCAL_ROLL_LANDING_MS);
});

test('local landing starts moving immediately and accelerates continuously', () => {
  assert.equal(getLocalLandingDropProgress(0), 0);
  assert.ok(getLocalLandingDropProgress(0.05) > 0);
  assert.ok(getLocalLandingDropProgress(0.1) < getLocalLandingDropProgress(0.5));
  assert.ok(getLocalLandingDropProgress(0.5) < getLocalLandingDropProgress(0.9));
  assert.equal(getLocalLandingDropProgress(1), 1);
});

test('only result-hold is a terminal live roll phase', () => {
  assert.equal(isTerminalLiveRollPhase('primary'), false);
  assert.equal(isTerminalLiveRollPhase('extra-spin'), false);
  assert.equal(isTerminalLiveRollPhase('landing'), false);
  assert.equal(isTerminalLiveRollPhase('resolved'), false);
  assert.equal(isTerminalLiveRollPhase(undefined), false);
  assert.equal(isTerminalLiveRollPhase('result-hold'), true);
});

test('pending phases use the local timeline and resolved rolls use the remote timeline', () => {
  assert.equal(getYutRollPreResultDurationMs('primary'), LOCAL_ROLL_PRE_RESULT_MS);
  assert.equal(getYutRollPreResultDurationMs('extra-spin'), LOCAL_ROLL_PRE_RESULT_MS);
  assert.equal(getYutRollPreResultDurationMs('landing'), LOCAL_ROLL_PRE_RESULT_MS);
  assert.equal(getYutRollPreResultDurationMs('resolved'), REMOTE_ROLL_PRE_RESULT_MS);
  assert.equal(getYutRollPreResultDurationMs(undefined), REMOTE_ROLL_PRE_RESULT_MS);
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

test('Perfect와 Nice 정상 착지는 기존 중앙 좌표를 그대로 유지한다', () => {
  const expected = [
    { x: -1.32, z: -0.24 },
    { x: -0.44, z: 0 },
    { x: 0.44, z: -0.24 },
    { x: 1.32, z: 0 },
  ];
  for (const zone of ['perfect', 'nice'] as const) {
    assert.equal(getYutRollLandingProfile(zone), 'centered');
    assert.deepEqual(
      getLandingTargets(zone).map(({ x, z, cssX, cssY }) => ({ x, z, cssX, cssY })),
      expected.map(({ x, z }) => ({ x, z, cssX: 0, cssY: 0 })),
    );
  }
});

test('Good은 전체 착지 중심을 소폭 이동하고 Bad는 윷 사이 분산도를 증가시킨다', () => {
  const centered = getLandingTargets('nice');
  const good = getLandingTargets('good');
  const bad = getLandingTargets('bad');

  assert.equal(getYutRollLandingProfile('good'), 'offset');
  assert.equal(getYutRollLandingProfile('bad'), 'scattered');
  assert.ok(getCenterX(good) > getCenterX(centered));
  assert.ok(getCenterX(good) - getCenterX(centered) < 0.5);
  assert.equal(getHorizontalSpread(good), getHorizontalSpread(centered));
  assert.ok(getHorizontalSpread(bad) > getHorizontalSpread(centered));
  assert.ok(getDepthSpread(bad) > getDepthSpread(centered));
});

test('레거시 Normal은 기존 중앙 착지 프로필을 유지한다', () => {
  assert.equal(getYutRollLandingProfile('normal'), 'centered');
  assert.deepEqual(getLandingTargets('normal'), getLandingTargets('nice'));
});

test('정상 윷 착지는 실제 매트 경계 안쪽에 남는다', () => {
  const bounds = getYutRollMatWorldBounds(620, 430, 96, 524);
  for (const zone of ['perfect', 'nice', 'good', 'bad', 'normal'] as const) {
    getLandingTargets(zone).forEach((_, index) => {
      const target = getYutRollLandingTarget(index, zone, bounds);
      assert.ok(target.x > bounds.leftX, `${zone} stick ${index} left edge`);
      assert.ok(target.x < bounds.rightX, `${zone} stick ${index} right edge`);
    });
  }
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
