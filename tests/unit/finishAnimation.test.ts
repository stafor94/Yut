import assert from 'node:assert/strict';
import test from 'node:test';
import type { FinishAnimationPiece } from '../../src/app/flows/finishAnimation.js';
import {
  FINISH_EFFECT_MS,
  FINISH_STAGGER_MS,
  createFinishVisualEffect,
  getFinishExitTarget,
  inferFinishedPieceIds,
} from '../../src/app/flows/finishAnimation.js';

const makePiece = (overrides: Partial<FinishAnimationPiece>): FinishAnimationPiece => ({
  id: 'piece',
  label: '말 1',
  ownerId: 'player-1',
  color: '#d94a38',
  nodeIndex: 0,
  nodeId: 'n01',
  started: true,
  finished: false,
  previousNodeId: 'n20',
  ...overrides,
});

test('finish jump continues through the start node in the incoming direction', () => {
  const outerFinish = getFinishExitTarget('n20');
  const shortcutFinish = getFinishExitTarget('d04');

  assert.ok(outerFinish.left > 100);
  assert.ok(Math.abs(outerFinish.top - 92) < 2);
  assert.ok(shortcutFinish.left > 100);
  assert.ok(shortcutFinish.top > 100);
});

test('stacked finish pieces are staggered and extend the visual hold duration', () => {
  const previousPieces = [
    makePiece({ id: 'piece-1' }),
    makePiece({ id: 'piece-2' }),
    makePiece({ id: 'piece-3' }),
  ];
  const effect = createFinishVisualEffect({
    id: 1,
    pieceIds: previousPieces.map((piece) => piece.id),
    previousPieces,
  });

  if (!effect) throw new Error('finish effect was not created');
  assert.deepEqual(effect.pieces.map((piece) => piece.delayMs), [0, FINISH_STAGGER_MS, FINISH_STAGGER_MS * 2]);
  assert.equal(effect.durationMs, FINISH_EFFECT_MS + FINISH_STAGGER_MS * 2);
});

test('finish inference only returns pieces that transitioned from the board to finished', () => {
  const previousPieces = [
    makePiece({ id: 'finisher' }),
    makePiece({ id: 'still-moving', nodeId: 'n18' }),
    makePiece({ id: 'already-finished', started: false, finished: true, nodeId: 'finish' }),
  ];
  const pieces = [
    makePiece({ id: 'finisher', started: false, finished: true, nodeId: 'finish', previousNodeId: undefined }),
    makePiece({ id: 'still-moving', nodeId: 'n19' }),
    makePiece({ id: 'already-finished', started: false, finished: true, nodeId: 'finish' }),
  ];

  assert.deepEqual(inferFinishedPieceIds({ previousPieces, pieces }), ['finisher']);
});
