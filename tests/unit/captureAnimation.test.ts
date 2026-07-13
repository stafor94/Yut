import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaptureAnimationPiece } from '../../src/app/flows/captureAnimation.js';
import {
  CAPTURE_EFFECT_MS,
  CAPTURE_FLIGHT_MS,
  CAPTURE_IMPACT_DELAY_MS,
  CAPTURE_SLOW_MOTION_MS,
  createCaptureVisualEffect,
  getCaptureExitTarget,
  inferCapturedPieceIds,
} from '../../src/app/flows/captureAnimation.js';

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

test('capture approach uses an exact 400ms slow-motion window', () => {
  assert.equal(CAPTURE_SLOW_MOTION_MS, 400);
  assert.equal(CAPTURE_EFFECT_MS, CAPTURE_IMPACT_DELAY_MS + CAPTURE_FLIGHT_MS);
});

test('outer corners eject pieces through the nearest natural board edge', () => {
  const topRight = getCaptureExitTarget('n06', 'n05');
  const bottomLeft = getCaptureExitTarget('n16', 'n15');

  assert.ok(topRight.left > 100);
  assert.ok(topRight.top < 0);
  assert.ok(bottomLeft.left < 0);
  assert.ok(bottomLeft.top > 100);
});

test('center captures continue the attackers incoming direction', () => {
  const fromTopLeft = getCaptureExitTarget('c01', 'd02');
  const fromTopRight = getCaptureExitTarget('c01', 'd06');

  assert.ok(fromTopLeft.left > 100);
  assert.ok(fromTopLeft.top > 100);
  assert.ok(fromTopRight.left < 0);
  assert.ok(fromTopRight.top > 100);
});

test('stacked captured pieces fan out to distinct targets', () => {
  const capturedPieces = [
    makePiece({ id: 'target-1', ownerId: 'player-2', nodeId: 'n06' }),
    makePiece({ id: 'target-2', ownerId: 'player-2', nodeId: 'n06' }),
    makePiece({ id: 'target-3', ownerId: 'player-2', nodeId: 'n06' }),
  ];
  const attacker = makePiece({ id: 'attacker', nodeId: 'n06', previousNodeId: 'n05' });
  const effect = createCaptureVisualEffect({
    id: 1,
    pieceIds: capturedPieces.map((piece) => piece.id),
    pieces: [attacker, ...capturedPieces],
    attackerPieceId: attacker.id,
    getPieceGroupKey: (piece) => piece.ownerId,
  });

  if (!effect) throw new Error('capture effect was not created');
  assert.equal(effect.pieces.length, 3);
  assert.equal(new Set(effect.pieces.map((piece) => `${piece.targetLeft}:${piece.targetTop}`)).size, 3);
  assert.equal(new Set(effect.pieces.map((piece) => piece.rotation)).size, 3);
});

test('remote capture inference requires the moving attacker to remain on the captured node', () => {
  const previousPieces = [
    makePiece({ id: 'attacker', nodeId: 'n06', ownerId: 'player-1' }),
    makePiece({ id: 'target', nodeId: 'n06', ownerId: 'player-2' }),
  ];
  const capturedPieces = [
    makePiece({ id: 'attacker', nodeId: 'n06', ownerId: 'player-1' }),
    makePiece({ id: 'target', nodeId: 'n01', nodeIndex: 0, ownerId: 'player-2', started: false }),
  ];
  const trapReturnPieces = [
    makePiece({ id: 'attacker', nodeId: 'n01', nodeIndex: 0, ownerId: 'player-1', started: false }),
    makePiece({ id: 'target', nodeId: 'n06', ownerId: 'player-2' }),
  ];

  assert.deepEqual(inferCapturedPieceIds({
    previousPieces,
    pieces: capturedPieces,
    attackerPieceId: 'attacker',
    getPieceGroupKey: (piece) => piece.ownerId,
  }), ['target']);

  assert.deepEqual(inferCapturedPieceIds({
    previousPieces,
    pieces: trapReturnPieces,
    attackerPieceId: 'attacker',
    getPieceGroupKey: (piece) => piece.ownerId,
  }), []);
});
