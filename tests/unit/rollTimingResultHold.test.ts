import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRollTimingResultHoldStyle,
  ROLL_TIMING_RESULT_HOLD_MS,
} from '../../src/app/flows/rollTimingResultHold.js';

test('멈춘 타이밍 위치를 정확히 1초간 유지한다', () => {
  assert.equal(ROLL_TIMING_RESULT_HOLD_MS, 1000);
});

test('원본 타이밍 막대의 화면 좌표와 크기로 고정 오버레이를 배치한다', () => {
  assert.deepEqual(getRollTimingResultHoldStyle({ top: 120.5, left: 16, width: 320, height: 24 }), {
    position: 'fixed',
    top: '120.5px',
    left: '16px',
    width: '320px',
    height: '24px',
    margin: '0',
    pointerEvents: 'none',
    zIndex: '1000',
  });
});
