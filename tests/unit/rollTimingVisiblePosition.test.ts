import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getRollTimingZone } from '../../src/game-core/roll.js';
import {
  getRollTimingOrbLeft,
  getRollTimingTrackTransform,
  getVisibleRollTimingPositionPercent,
  normalizeRollTimingPositionPercent,
} from '../../src/app/flows/rollTimingVisiblePosition.js';

const meterRect = { left: 100, width: 200 };
const orbRectAt = (positionPercent: number) => ({
  left: meterRect.left + meterRect.width * (positionPercent / 100) - 6,
  width: 12,
});
const timingControlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const timingCss = readFileSync('src/styles/roll-timing-ios-smoothness.css', 'utf8');

test('canonical 타이밍 퍼센트 하나에서 고정 track 내부 orb left를 파생한다', () => {
  assert.equal(normalizeRollTimingPositionPercent(45.12349), 45.123);
  assert.equal(normalizeRollTimingPositionPercent(-1), 0);
  assert.equal(normalizeRollTimingPositionPercent(101), 100);
  assert.equal(getRollTimingOrbLeft(-1), '0%');
  assert.equal(getRollTimingOrbLeft(0), '0%');
  assert.equal(getRollTimingOrbLeft(50), '50%');
  assert.equal(getRollTimingOrbLeft(100), '100%');
  assert.equal(getRollTimingOrbLeft(101), '100%');
  assert.equal(getRollTimingOrbLeft(45.12349), '45.123%');
  assert.equal(getRollTimingTrackTransform(45.12349), 'translate3d(45.123%, 0, 0)');
});

test('화면에 보이는 구슬 중심 좌표를 막대 기준 퍼센트로 계산한다', () => {
  assert.equal(getVisibleRollTimingPositionPercent(meterRect, orbRectAt(58.5)), 58.5);
  assert.equal(getVisibleRollTimingPositionPercent(meterRect, orbRectAt(-5)), 0);
  assert.equal(getVisibleRollTimingPositionPercent(meterRect, orbRectAt(105)), 100);
  assert.equal(getVisibleRollTimingPositionPercent({ left: 0, width: 0 }, orbRectAt(50)), undefined);
});

test('화면 좌표 판정은 등급 경계와 일치한다', () => {
  const expected = [
    [44.9, 'nice'],
    [45, 'perfect'],
    [55, 'perfect'],
    [55.1, 'nice'],
    [59, 'nice'],
    [60, 'nice'],
    [60.1, 'good'],
  ] as const;

  for (const [positionPercent, zone] of expected) {
    const visiblePosition = getVisibleRollTimingPositionPercent(meterRect, orbRectAt(positionPercent));
    assert.notEqual(visiblePosition, undefined);
    assert.equal(getRollTimingZone(visiblePosition!), zone);
  }
});

test('제품 writer는 고정 track이 아니라 orb left만 snapshot percent로 갱신한다', () => {
  assert.match(timingControlSource, /track\.style\.transform = 'none'/);
  assert.match(timingControlSource, /orb\.style\.left = getRollTimingOrbLeft\(snapshot\.positionPercent\)/);
  assert.match(timingControlSource, /heldOrb\.style\.left = getRollTimingOrbLeft\(snapshot\.positionPercent\)/);
  assert.doesNotMatch(timingControlSource, /track\.style\.transform = getRollTimingTrackTransform/);
});

test('타이밍 track 내부에서만 paint를 제한하고 전역 가로 overflow 숨김은 추가하지 않는다', () => {
  assert.match(timingCss, /\.roll-timing-orb-track[\s\S]*overflow:\s*hidden/);
  assert.match(timingCss, /\.roll-timing-orb-track[\s\S]*transform:\s*none/);
  assert.match(timingCss, /\.roll-timing-orb[\s\S]*transform:\s*translate3d\(-50%, -50%, 0\)/);
  assert.doesNotMatch(timingCss, /(?:html|body|#root)[^{]*\{[^}]*overflow-x:\s*hidden/);
});
