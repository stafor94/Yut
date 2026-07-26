import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getRollTimingResultHoldStyle,
  ROLL_TIMING_RESULT_HOLD_MS,
} from '../../src/app/flows/rollTimingResultHold.js';

test('멈춘 타이밍 위치를 정확히 1초간 유지한다', () => {
  assert.equal(ROLL_TIMING_RESULT_HOLD_MS, 1000);
});

test('정지 결과 막대를 원래 컨트롤 grid 흐름에 유지한다', () => {
  assert.deepEqual(getRollTimingResultHoldStyle(), {
    position: 'relative',
    margin: '0',
    pointerEvents: 'none',
    justifySelf: 'center',
  });
});
