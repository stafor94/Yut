import assert from 'node:assert/strict';
import test from 'node:test';
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
