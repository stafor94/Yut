import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachClientActionStartedAt,
  clearNextDeadlineAutoAction,
  markNextDeadlineAutoAction,
} from '../../src/features/room/services/turnActionStartedAtPolicy';
import {
  aliasTimeoutRollMutationIds,
  clearTimeoutRollMutationAliases,
} from '../../src/features/room/services/timeoutRollActionIdentity';
import { makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers';

const ACTIVE_ROOM_STORAGE_KEY = 'yut-online:activeRoomId';

function installActiveRoomStorage(roomId: string) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => key === ACTIVE_ROOM_STORAGE_KEY ? roomId : null,
      },
    },
  });
  return () => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}

test.afterEach(() => {
  clearNextDeadlineAutoAction();
});

test('온라인 이동 마감 UI와 stalled/coordinator 복구는 동일 timeout action identity를 사용한다', () => {
  const roomId = 'room-timeout-move-identity';
  const actorId = 'seat-host';
  const timeoutDeadlineAt = 2_000_000;
  const localMoveActionId = 'move_piece:seat-host:17:3:개:2:::-piece-1:0:outer:stack:none';
  const restoreWindow = installActiveRoomStorage(roomId);

  try {
    markNextDeadlineAutoAction({
      actionType: 'move_piece',
      actorId,
      deadlineAt: timeoutDeadlineAt,
      now: timeoutDeadlineAt - 1_000,
    });
    const deadlineUiAction = attachClientActionStartedAt({
      type: 'move_piece',
      actorId,
      payload: {
        clientActionId: localMoveActionId,
        pieceId: `${actorId}-piece-1`,
        branchChoice: 'outer',
        rollStackIndex: null,
      },
    }, timeoutDeadlineAt - 10);
    const stalledRecoveryActionId = makeTimeoutActionKey({
      roomId,
      stage: 'move',
      actorId,
      timeoutDeadlineAt,
    });
    const coordinatorRecoveryActionId = makeTimeoutActionKey({
      roomId,
      stage: 'move',
      actorId,
      timeoutDeadlineAt,
      sequence: 99,
      extra: 'coordinator-retry',
    });

    assert.equal(deadlineUiAction.payload?.deadlineAutoSubmitted, true);
    assert.equal(deadlineUiAction.payload?.autoSubmittedDeadlineAt, timeoutDeadlineAt);
    assert.equal(deadlineUiAction.payload?.clientActionId, stalledRecoveryActionId);
    assert.equal(coordinatorRecoveryActionId, stalledRecoveryActionId);

    const aliasedEcho = aliasTimeoutRollMutationIds(roomId, {
      clientMutationId: stalledRecoveryActionId,
      action: {
        type: 'move_piece',
        payload: { clientActionId: stalledRecoveryActionId },
      },
      stateAfter: { lastClientMutationId: stalledRecoveryActionId },
    });
    assert.equal(aliasedEcho.clientMutationId, localMoveActionId);
    assert.equal(aliasedEcho.action.payload.clientActionId, localMoveActionId);
    assert.equal(aliasedEcho.stateAfter.lastClientMutationId, localMoveActionId);
  } finally {
    clearTimeoutRollMutationAliases(roomId);
    restoreWindow();
  }
});

test('timeout 이동 identity는 sequence·로그·moving 상태가 달라도 deadline 기준으로 고정된다', () => {
  const base = {
    roomId: 'room-stable-timeout-move',
    stage: 'move' as const,
    actorId: 'seat-1',
    timeoutDeadlineAt: 9_876_543,
  };
  const identities = [
    makeTimeoutActionKey(base),
    makeTimeoutActionKey({ ...base, sequence: 1, extra: 'moving:' }),
    makeTimeoutActionKey({ ...base, sequence: 999, extra: 'logs:changed' }),
  ];
  assert.deepEqual(new Set(identities), new Set([identities[0]]));
});
