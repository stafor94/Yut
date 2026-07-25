import assert from 'node:assert/strict';
import test from 'node:test';
import { getRollTimingZone } from '../../src/game-core/roll.js';
import {
  getVisibleRollTimingPositionPercent,
  getVisibleRollTimingTrackOffsetPx,
} from '../../src/app/flows/rollTimingVisiblePosition.js';

const meterRect = { left: 100, width: 200 };
const orbRectAt = (positionPercent: number) => ({
  left: meterRect.left + meterRect.width * (positionPercent / 100) - 6,
  width: 12,
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

test('화면에 표시된 track 이동량을 픽셀 단위로 고정할 수 있다', () => {
  assert.equal(getVisibleRollTimingTrackOffsetPx(meterRect, { left: 217, width: 200 }), 117);
  assert.equal(getVisibleRollTimingTrackOffsetPx(meterRect, { left: Number.NaN, width: 200 }), undefined);
});
