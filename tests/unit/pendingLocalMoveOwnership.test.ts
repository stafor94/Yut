import assert from 'node:assert/strict';
import test from 'node:test';
import { localMovePresentationLifecycle } from '../../src/app/flows/localMovePresentationLifecycle.js';
import {
  clearPendingLocalMoveOwnershipPreparer,
  preparePendingLocalMoveOwnership,
  publishPendingLocalMoveOwnershipPreparer,
  requiresPendingLocalMoveOwnership,
  type PendingLocalMoveOwnershipPreparer,
} from '../../src/app/flows/pendingLocalMoveOwnership.js';

test('pending claim 단계에서 pre-move action snapshot을 동기적으로 ownership preparer에 전달한다', () => {
  const calls: unknown[] = [];
  const preparer: PendingLocalMoveOwnershipPreparer = (action) => {
    calls.push(action);
    return true;
  };
  publishPendingLocalMoveOwnershipPreparer(preparer);
  const actionKey = 'move_piece:P1:10:0:걸:3:::P1-1:0:outer:stack:none';

  assert.equal(requiresPendingLocalMoveOwnership(actionKey), true);
  assert.equal(preparePendingLocalMoveOwnership(actionKey), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    type: 'move_piece',
    actorId: 'P1',
    payload: {
      clientActionId: actionKey,
      pieceId: 'P1-1',
      extraSteps: 0,
      branchChoice: 'outer',
      rollStackIndex: null,
    },
  });
  clearPendingLocalMoveOwnershipPreparer(preparer);
});

test('roll이 ready인 명시적 stacked move도 marker 기준으로 ownership preparer에 전달한다', () => {
  const calls: unknown[] = [];
  const preparer: PendingLocalMoveOwnershipPreparer = (action) => {
    calls.push(action);
    return true;
  };
  publishPendingLocalMoveOwnershipPreparer(preparer);
  const actionKey = 'move_piece:P1:10:0:ready:::P1-1:0:outer:stack:0';

  assert.equal(requiresPendingLocalMoveOwnership(actionKey), true);
  assert.equal(preparePendingLocalMoveOwnership(actionKey), true);
  assert.deepEqual(calls, [{
    type: 'move_piece',
    actorId: 'P1',
    payload: {
      clientActionId: actionKey,
      pieceId: 'P1-1',
      extraSteps: 0,
      branchChoice: 'outer',
      rollStackIndex: 0,
    },
  }]);

  clearPendingLocalMoveOwnershipPreparer(preparer);
});

test('0칸 이동은 경로 ledger를 만들지 않고 pending presentation lifecycle만 해제한다', () => {
  const calls: unknown[] = [];
  const preparer: PendingLocalMoveOwnershipPreparer = (action) => {
    calls.push(action);
    return true;
  };
  publishPendingLocalMoveOwnershipPreparer(preparer);
  const actionKey = 'move_piece:P1:10:0:도:1:::P1-1:-1:outer:stack:none';
  localMovePresentationLifecycle.begin(actionKey);

  assert.equal(preparePendingLocalMoveOwnership(actionKey), true);
  assert.equal(calls.length, 0);
  assert.equal(localMovePresentationLifecycle.snapshot().phase, 'idle');

  clearPendingLocalMoveOwnershipPreparer(preparer);
  localMovePresentationLifecycle.cancel();
});
