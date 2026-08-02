import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalMoveLedger } from '../../src/app/flows/localMoveOwnership';
import { LocalMovePresentationLifecycle } from '../../src/app/flows/localMovePresentationLifecycle';

test('local move ledger 등록은 idle lifecycle의 실제 piece settlement를 먼저 예약한다', async () => {
  const lifecycle = new LocalMovePresentationLifecycle();
  const ledger = new LocalMoveLedger(lifecycle);
  const finalState = {
    pieces: [{ id: 'piece-1', ownerId: 'P1', nodeId: 'n04', nodeIndex: 3, started: true, finished: false }],
  };

  ledger.register({
    roomId: 'room-a',
    clientMutationId: 'move_piece:P1:10:piece-1',
    startSequence: 10,
    startTurnIndex: 0,
    pieceId: 'piece-1',
    movingGroupIds: ['piece-1'],
    fromNodeId: 'n01',
    toNodeId: 'n04',
    pathNodeIds: ['n02', 'n03', 'n04'],
    finalPieces: finalState.pieces,
    finalState,
    resultFingerprint: 'local-result',
  });

  let settled = false;
  const settlement = lifecycle.waitForSettlement().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  assert.equal(lifecycle.observe('piece-1'), true);
  assert.equal(lifecycle.settle('piece-1'), true);
  await settlement;
  assert.equal(settled, true);
});
