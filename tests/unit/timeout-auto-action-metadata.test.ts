import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachClientActionStartedAt,
  clearNextDeadlineAutoAction,
  markNextDeadlineAutoAction,
} from '../../src/features/room/services/turnActionStartedAtPolicy';
import { canonicalizeTimeoutRollAction } from '../../src/features/room/services/timeoutRollActionIdentity';

test('timedOut move도 deadline marker를 소비해 authoritative timeout metadata를 포함한다', () => {
  clearNextDeadlineAutoAction();
  markNextDeadlineAutoAction({ actionType: 'move_piece', actorId: 'seat-1', deadlineAt: 10_000, now: 9_800 });
  const action = attachClientActionStartedAt({
    type: 'move_piece',
    actorId: 'seat-1',
    payload: {
      clientActionId: 'move:seat-1:auto',
      timedOut: true,
      recoveredByCoordinator: true,
    },
  }, 9_920);
  const payload = action.payload as Record<string, unknown>;
  assert.equal(payload.deadlineAutoSubmitted, true);
  assert.equal(payload.autoSubmittedDeadlineAt, 10_000);
  assert.equal(payload.clientActionStartedAt, 9_920);
});

test('marker가 없는 coordinator action은 사용자 수동 행동으로 오분류되지 않도록 그대로 둔다', () => {
  clearNextDeadlineAutoAction();
  const action = {
    type: 'move_piece',
    actorId: 'seat-1',
    payload: { clientActionId: 'move-ai', coordinatorSeatId: 'seat-2' },
  };
  assert.equal(attachClientActionStartedAt(action, 9_920), action);
});

test('즉시 제출 timeout roll canonicalization은 복구 유예 없이 timeout 집계 표식을 보존한다', () => {
  const deadlineAt = 50_000;
  const action = canonicalizeTimeoutRollAction('room-1', {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      clientActionId: 'roll-local-1',
      timedOut: true,
      timeoutDeadlineAt: deadlineAt,
      timingPositionPercent: 75,
      rollTimingZone: 'bad',
    },
  });
  const payload = action.payload as Record<string, unknown>;
  assert.equal(payload.resolvedTimeoutDeadlineAt, deadlineAt);
  assert.equal(payload.deadlineAutoSubmitted, true);
  assert.equal(payload.autoSubmittedDeadlineAt, deadlineAt);
  assert.ok(Number(payload.clientActionStartedAt) > 0);
  assert.ok(Number(payload.clientActionStartedAt) < deadlineAt);
  assert.equal(payload.timeoutDeadlineAt, undefined);
  assert.match(String(payload.clientActionId), /^timeout:/);
});
