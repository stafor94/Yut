import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createActiveLocalCaptureVisualEffect,
  type CaptureAnimationPiece,
} from '../../src/app/flows/captureAnimation.js';
import { localMoveLedger } from '../../src/app/flows/localMoveOwnership.js';

const makePiece = (overrides: Partial<CaptureAnimationPiece>): CaptureAnimationPiece => ({
  id: 'piece',
  label: '말 1',
  ownerId: 'player-1',
  color: '#d94a38',
  nodeIndex: 0,
  nodeId: 'n01',
  started: true,
  finished: false,
  ...overrides,
});

const registerLocalMove = ({
  actionKey,
  presentationPieces,
  finalPieces,
}: {
  actionKey: string;
  presentationPieces: CaptureAnimationPiece[];
  finalPieces: CaptureAnimationPiece[];
}) => {
  const attacker = presentationPieces.find((piece) => piece.id === 'attacker');
  if (!attacker) throw new Error('attacker missing');
  localMoveLedger.remove(actionKey);
  localMoveLedger.register({
    roomId: 'room-capture-prime',
    clientMutationId: actionKey,
    startSequence: 12,
    startTurnIndex: 0,
    pieceId: attacker.id,
    movingGroupIds: [attacker.id],
    fromNodeId: 'n16',
    toNodeId: 'n19',
    pathNodeIds: ['n17', 'n18', 'n19'],
    finalPieces,
    finalState: { pieces: finalPieces },
    resultFingerprint: 'capture-prime',
  });
};

test('local capture is primed from reducer finalPieces with the stable move key', () => {
  const actionKey = 'move_piece:player-1:12:attacker';
  const attacker = makePiece({ id: 'attacker', ownerId: 'player-1', nodeId: 'n19', previousNodeId: 'n18' });
  const targetAtDestination = makePiece({ id: 'target', ownerId: 'player-2', nodeId: 'n19' });
  const targetReset = makePiece({ id: 'target', ownerId: 'player-2', nodeId: 'n01', started: false });
  const presentationPieces = [attacker, targetAtDestination];
  const finalPieces = [attacker, targetReset];
  registerLocalMove({ actionKey, presentationPieces, finalPieces });

  try {
    const effect = createActiveLocalCaptureVisualEffect({
      pieces: presentationPieces,
      attackerPieceId: attacker.id,
      getPieceGroupKey: (piece) => piece.ownerId,
    });
    assert.ok(effect);
    assert.equal(effect.presentationKey, actionKey);
    assert.equal(effect.nodeId, 'n19');
    assert.deepEqual(effect.pieceIds, ['target']);
    assert.deepEqual(effect.attackerPieceIds, ['attacker']);
  } finally {
    localMoveLedger.remove(actionKey);
  }
});

test('local capture priming ignores an opponent that reducer finalPieces keeps on board', () => {
  const actionKey = 'move_piece:player-1:13:attacker';
  const attacker = makePiece({ id: 'attacker', ownerId: 'player-1', nodeId: 'n19', previousNodeId: 'n18' });
  const shieldedTarget = makePiece({ id: 'target', ownerId: 'player-2', nodeId: 'n19' });
  const pieces = [attacker, shieldedTarget];
  registerLocalMove({ actionKey, presentationPieces: pieces, finalPieces: pieces });

  try {
    assert.equal(createActiveLocalCaptureVisualEffect({
      pieces,
      attackerPieceId: attacker.id,
      getPieceGroupKey: (piece) => piece.ownerId,
    }), null);
  } finally {
    localMoveLedger.remove(actionKey);
  }
});
