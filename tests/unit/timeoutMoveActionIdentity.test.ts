import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeGameActionQueues } from '../../src/app/flows/authoritativeGameSyncFlow';
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

test.afterEach(() => {
  clearNextDeadlineAutoAction();
});

test('온라인 이동 마감 UI와 stalled/coordinator 복구는 동일 timeout action identity를 사용한다', async () => {
  const roomId = 'room-timeout-move-identity';
  const actorId = 'seat-host';
  const timeoutDeadlineAt = 2_000_000;
  const localMoveActionId = 'move_piece:seat-host:17:3:개:2:::-piece-1:0:outer:stack:none';

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
    const deadlineUiPayload = deadlineUiAction.payload as Record<string, unknown>;
    const committedActions: typeof deadlineUiAction[] = [];
    const queues = createAuthoritativeGameActionQueues<typeof deadlineUiAction, { status: 'committed' }>({
      activeRoomIdRef: { current: roomId },
      commit: async (_committedRoomId, action) => {
        committedActions.push(action);
        return { status: 'committed' };
      },
      yieldBetweenApplies: async () => undefined,
    });

    assert.equal(deadlineUiPayload.deadlineAutoSubmitted, true);
    assert.equal(deadlineUiPayload.autoSubmittedDeadlineAt, timeoutDeadlineAt);
    assert.equal(deadlineUiPayload.clientActionId, localMoveActionId);
    assert.equal(coordinatorRecoveryActionId, stalledRecoveryActionId);

    await queues.commitQueuedAuthoritativeGameAction(roomId, deadlineUiAction);
    assert.equal(committedActions.length, 1);
    const committedPayload = committedActions[0].payload as Record<string, unknown>;
    assert.equal(committedPayload.clientActionId, stalledRecoveryActionId);
    assert.equal(committedPayload.timeoutDeadlineAt, timeoutDeadlineAt);

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
