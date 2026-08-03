import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ONLINE_ROLL_FAST_PRESENTATION_MS,
  ONLINE_ROLL_RESULT_HOLD_MS,
  getAuthoritativeRollPresentationReadyAt,
} from '../../src/features/room/services/rollPresentationTiming.js';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming.js';
import { getTurnActionReadyAt } from '../../src/features/room/services/turnDeadlinePolicy.js';

test('빠른 온라인 응답 readyAt은 primary 1200 + landing 1000 + hold 1000 = 3200ms다', () => {
  const startedAt = 10_000;
  assert.equal(ONLINE_ROLL_RESULT_HOLD_MS, 1_000);
  assert.equal(ONLINE_ROLL_FAST_PRESENTATION_MS, 3_200);
  const readyAt = getAuthoritativeRollPresentationReadyAt({
    actionStartedAt: startedAt,
    resolvedAt: startedAt + 500,
  });
  assert.equal(readyAt, startedAt + 3_200);
  const deadlineAt = readyAt + TURN_ACTION_TIMEOUT_MS;
  assert.equal(getTurnActionReadyAt({ deadlineAt, durationMs: TURN_ACTION_TIMEOUT_MS }), readyAt);
});

test('지연 응답은 기존 1000ms extra-spin 경계에 landing과 새 hold를 정렬한다', () => {
  const startedAt = 10_000;
  assert.equal(getAuthoritativeRollPresentationReadyAt({ actionStartedAt: startedAt, resolvedAt: startedAt + 1_201 }), startedAt + 4_200);
  assert.equal(getAuthoritativeRollPresentationReadyAt({ actionStartedAt: startedAt, resolvedAt: startedAt + 2_200 }), startedAt + 4_200);
  assert.equal(getAuthoritativeRollPresentationReadyAt({ actionStartedAt: startedAt, resolvedAt: startedAt + 2_201 }), startedAt + 5_200);
});
