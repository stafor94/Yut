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

test('track의 실제 화면 위치와 변환 전 layout 원점 차이를 픽셀 고정값으로 계산한다', () => {
  assert.equal(getVisibleRollTimingTrackOffsetPx({ left: 217, width: 200 }, 104), 113);
  assert.equal(getVisibleRollTimingTrackOffsetPx({ left: Number.NaN, width: 200 }, 104), undefined);
  assert.equal(getVisibleRollTimingTrackOffsetPx({ left: 217, width: 200 }, Number.NaN), undefined);
});
