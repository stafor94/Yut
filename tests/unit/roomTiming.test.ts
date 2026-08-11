import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTurnOrderIntroCompletionTiming,
  TURN_ACTION_TIMEOUT_MS,
  TURN_ACTION_TIMEOUT_MIN_MS,
} from '../../src/features/room/services/roomTiming.js';

test('turn-order intro 완료 시 현재 active seat의 첫 roll deadline을 완료 시점부터 시작한다', () => {
  const completedAt = 1_000_000;

  assert.deepEqual(getTurnOrderIntroCompletionTiming({
    completedAt,
    turnOrderIds: ['P1', 'P2'],
    turnIndex: 0,
    turnActionTimeoutCountBySeatId: {},
  }), {
    turnDeadlineAt: completedAt + TURN_ACTION_TIMEOUT_MS,
    turnDeadlineKind: 'roll',
  });
});

test('turn-order intro 완료 시 active seat의 기존 timeout count 정책을 그대로 적용한다', () => {
  const completedAt = 2_000_000;

  assert.deepEqual(getTurnOrderIntroCompletionTiming({
    completedAt,
    turnOrderIds: ['P1', 'P2'],
    turnIndex: 1,
    turnActionTimeoutCountBySeatId: { P2: 2 },
  }), {
    turnDeadlineAt: completedAt + TURN_ACTION_TIMEOUT_MIN_MS,
    turnDeadlineKind: 'roll',
  });
});

test('유효한 active seat가 없으면 intro 완료가 임의의 roll deadline을 만들지 않는다', () => {
  assert.deepEqual(getTurnOrderIntroCompletionTiming({
    completedAt: 3_000_000,
    turnOrderIds: [],
    turnIndex: 0,
    turnActionTimeoutCountBySeatId: {},
  }), {
    turnDeadlineAt: 0,
    turnDeadlineKind: '',
  });
});