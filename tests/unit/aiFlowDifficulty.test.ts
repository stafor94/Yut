import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseAiMoveCandidate,
  scoreAiMove,
  type AiMoveCandidate,
} from '../../src/app/flows/aiFlow.js';

const aiSeat = { id: 'ai', team: '청팀', aiDifficulty: 'hard' } as any;
const easySeat = { ...aiSeat, aiDifficulty: 'easy' } as any;
const enemySeat = { id: 'enemy', team: '홍팀' } as any;
const movingPiece = { id: 'moving', ownerId: 'ai', nodeId: 'n02', nodeIndex: 1, started: true, finished: false, label: 'P2-1', color: '#000' } as any;
const enemyPiece = { id: 'enemy-piece', ownerId: 'enemy', nodeId: 'n03', nodeIndex: 2, started: true, finished: false, label: 'P1-1', color: '#fff' } as any;
const result = { name: '도', steps: 1 } as const;

const captureContext = {
  pieces: [movingPiece, enemyPiece],
  canSeatControlPiece: (seat: any, piece: any) => seat?.id === piece?.ownerId,
  getSeatById: (seatId: string) => seatId === 'ai' ? aiSeat : enemySeat,
  isSameSide: (left: any, right: any) => left?.team === right?.team,
};

test('finish, capture and stack weights are reduced by difficulty profile', () => {
  assert.equal(scoreAiMove(movingPiece, result, aiSeat, 'outer', captureContext, 'hard'), 92);
  assert.equal(scoreAiMove(movingPiece, result, easySeat, 'outer', captureContext, 'easy'), 57);

  const stackedContext = {
    ...captureContext,
    pieces: [movingPiece, { ...movingPiece, id: 'stacked' }],
  };
  assert.equal(scoreAiMove(movingPiece, result, aiSeat, 'outer', stackedContext, 'hard'), 14);
  assert.equal(scoreAiMove(movingPiece, result, easySeat, 'outer', stackedContext, 'easy'), 10);
});

const makeCandidate = (id: string, score: number): AiMoveCandidate => ({
  piece: { ...movingPiece, id } as any,
  branchChoice: 'outer',
  score,
});

test('hard AI excludes candidates more than 20 points below the best move', () => {
  const candidates = [makeCandidate('best', 100), makeCandidate('excluded', 79)];
  assert.equal(chooseAiMoveCandidate(candidates, 'hard', () => 0.999)?.piece.id, 'best');
});

test('hard AI can vary between similarly strong legal moves', () => {
  const candidates = [makeCandidate('best', 100), makeCandidate('second', 90)];
  assert.equal(chooseAiMoveCandidate(candidates, 'hard', () => 0.999)?.piece.id, 'second');
});

test('easy AI occasionally chooses an odd but legal move from all candidates', () => {
  const randomValues = [0.05, 0.99];
  const candidates = [makeCandidate('best', 100), makeCandidate('middle', 60), makeCandidate('odd', 5)];
  assert.equal(chooseAiMoveCandidate(candidates, 'easy', () => randomValues.shift() ?? 0)?.piece.id, 'odd');
});
