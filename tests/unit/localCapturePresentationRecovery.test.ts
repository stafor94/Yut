import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaptureAnimationPiece } from '../../src/app/flows/captureAnimation.js';
import {
  createCaptureVisualEffect,
  inferCapturedPieceIds,
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

const registerLocalCapture = () => {
  localMoveLedger.clear();
  localMoveLedger.register({
    roomId: 'room-1',
    clientMutationId: 'move_piece:local-capture',
    startSequence: 4,
    startTurnIndex: 0,
    pieceId: 'attacker',
    movingGroupIds: ['attacker'],
    fromNodeId: 'n16',
    toNodeId: 'n19',
    pathNodeIds: ['n17', 'n18', 'n19'],
    finalPieces: [
      makePiece({ id: 'attacker', ownerId: 'player-1', nodeId: 'n19', previousNodeId: 'n18' }),
      makePiece({ id: 'target', ownerId: 'player-2', nodeId: 'n01', started: false }),
    ],
    finalState: {},
    resultFingerprint: 'fingerprint',
  });
};

test('active local move final state recovers capture metadata without mutating board state', () => {
  registerLocalCapture();
  const currentPieces = [
    makePiece({ id: 'attacker', ownerId: 'player-1', nodeId: 'n19', previousNodeId: 'n18' }),
    makePiece({ id: 'target', ownerId: 'player-2', nodeId: 'n19' }),
  ];

  assert.deepEqual(inferCapturedPieceIds({
    previousPieces: currentPieces,
    pieces: currentPieces,
    attackerPieceId: 'attacker',
    getPieceGroupKey: (piece) => piece.ownerId,
  }), ['target']);
  assert.equal(currentPieces[1].nodeId, 'n19');
  assert.equal(currentPieces[1].started, true);
  localMoveLedger.clear();
});

test('local capture recovery canonicalizes presentation identity to the active move action', () => {
  registerLocalCapture();
  const effect = createCaptureVisualEffect({
    id: 99,
    presentationKey: 'capture-recovery:99:attacker:n19:target',
    pieceIds: ['target'],
    pieces: [
      makePiece({ id: 'attacker', ownerId: 'player-1', nodeId: 'n19', previousNodeId: 'n18' }),
      makePiece({ id: 'target', ownerId: 'player-2', nodeId: 'n19' }),
    ],
    attackerPieceId: 'attacker',
    getPieceGroupKey: (piece) => piece.ownerId,
  });

  assert.equal(effect?.presentationKey, 'move_piece:local-capture');
  assert.deepEqual(effect?.attackerPieceIds, ['attacker']);
  localMoveLedger.clear();
});
