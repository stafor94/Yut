import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingLocalMoveOwnershipPreparer,
  preparePendingLocalMoveOwnership,
  publishPendingLocalMoveOwnershipPreparer,
  type PendingLocalMoveOwnershipPreparer,
} from '../../src/app/flows/pendingLocalMoveOwnership.js';

const makeExactMoveAction = () => ({
  type: 'move_piece' as const,
  actorId: 'P1',
  payload: {
    pieceId: 'P1-piece-1',
    extraSteps: 0,
    branchChoice: 'outer',
    rollStackIndex: 0,
    rollName: '개',
    rollSteps: 2,
    clientActionId: 'move_piece:P1:misleading:tokens:must:not:be:parsed:stack:99',
    clientActionStartedAt: 1_234_567,
    deadlineAutoSubmitted: true,
    autoSubmittedDeadlineAt: 1_234_000,
    stackedMoveSelection: {
      selectionId: 'selection-exact',
      sourceSequence: 41,
      turnIndex: 0,
      rollStackIndex: 0,
    },
    actorLabel: 'P1',
    actorName: '사람',
    actorLogName: '사람',
  },
});

test('pending local move ownership은 exact action 객체와 payload를 preparer에 그대로 전달한다', () => {
  const action = makeExactMoveAction();
  let receivedRequest: Parameters<PendingLocalMoveOwnershipPreparer>[0] | null = null;
  const preparer: PendingLocalMoveOwnershipPreparer = (request) => {
    receivedRequest = request;
    return {
      ok: true,
      action: request.action,
      actionKey: String(request.action.payload?.clientActionId ?? ''),
    };
  };
  publishPendingLocalMoveOwnershipPreparer(preparer);
  try {
    const result = preparePendingLocalMoveOwnership({ action, totalSteps: 2 });
    assert.equal(result.ok, true);
    assert.equal(receivedRequest?.action, action);
    assert.equal(result.action, action);
    assert.equal(receivedRequest?.totalSteps, 2);
    assert.deepEqual(receivedRequest?.action.payload, action.payload);
    assert.equal(receivedRequest?.action.payload?.clientActionStartedAt, 1_234_567);
    assert.equal(receivedRequest?.action.payload?.deadlineAutoSubmitted, true);
    assert.equal(receivedRequest?.action.payload?.autoSubmittedDeadlineAt, 1_234_000);
    assert.deepEqual(receivedRequest?.action.payload?.stackedMoveSelection, action.payload.stackedMoveSelection);
  } finally {
    clearPendingLocalMoveOwnershipPreparer(preparer);
  }
});

test('actionKey 토큰이 payload와 충돌해도 문자열 parser로 piece/roll/stack identity를 복원하지 않는다', () => {
  const action = makeExactMoveAction();
  let receivedAction: typeof action | null = null;
  const preparer: PendingLocalMoveOwnershipPreparer = (request) => {
    receivedAction = request.action as typeof action;
    return {
      ok: true,
      action: request.action,
      actionKey: String(request.action.payload?.clientActionId ?? ''),
    };
  };
  publishPendingLocalMoveOwnershipPreparer(preparer);
  try {
    const result = preparePendingLocalMoveOwnership({ action, totalSteps: 2 });
    assert.equal(result.ok, true);
    assert.equal(receivedAction, action);
    assert.equal(receivedAction?.payload.pieceId, 'P1-piece-1');
    assert.equal(receivedAction?.payload.rollName, '개');
    assert.equal(receivedAction?.payload.rollSteps, 2);
    assert.equal(receivedAction?.payload.rollStackIndex, 0);
  } finally {
    clearPendingLocalMoveOwnershipPreparer(preparer);
  }
});

test('ownership preparer가 없으면 stage/reason을 보존한 구조화된 실패를 반환한다', () => {
  const action = makeExactMoveAction();
  const result = preparePendingLocalMoveOwnership({ action, totalSteps: 2 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.action, action);
  assert.equal(result.stage, 'ownership-preparer');
  assert.equal(result.reason, 'ownership-preparer-unavailable');
});
