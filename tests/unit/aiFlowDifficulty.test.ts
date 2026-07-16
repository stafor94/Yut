import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_SCORE_PROFILES,
  chooseScoredAiCandidate,
  type ScoredAiCandidate,
} from '../../src/game-core/aiStrategy.js';

type Candidate = ScoredAiCandidate & { id: string };
const candidate = (id: string, score: number): Candidate => ({ id, score });

test('AI difficulty profiles use the planned lower weights', () => {
  assert.deepEqual(AI_SCORE_PROFILES.hard, {
    finish: 80,
    capture: 90,
    shortcut: 55,
    start: 35,
    stack: 20,
    candidateRange: 20,
    rerollThreshold: 55,
  });
  assert.deepEqual(AI_SCORE_PROFILES.easy, {
    finish: 70,
    capture: 55,
    shortcut: 35,
    start: 25,
    stack: 15,
    candidateRange: 45,
    rerollThreshold: 35,
  });
});

test('hard AI ignores a move more than 20 points below the best score', () => {
  const moves = [candidate('best', 100), candidate('low', 79)];
  assert.equal(chooseScoredAiCandidate(moves, 'hard', () => 0.999)?.id, 'best');
});

test('hard AI can select a similarly strong move', () => {
  const moves = [candidate('best', 100), candidate('second', 90)];
  assert.equal(chooseScoredAiCandidate(moves, 'hard', () => 0.999)?.id, 'second');
});

test('easy AI sometimes selects any legal move', () => {
  let call = 0;
  const values = [0.05, 0.99];
  const moves = [candidate('best', 100), candidate('middle', 60), candidate('last', 5)];
  assert.equal(chooseScoredAiCandidate(moves, 'easy', () => values[call++] ?? 0)?.id, 'last');
});

test('easy AI regular selection includes moves within 45 points', () => {
  let call = 0;
  const values = [0.5, 0.999];
  const moves = [candidate('best', 100), candidate('near', 56), candidate('low', 54)];
  assert.equal(chooseScoredAiCandidate(moves, 'easy', () => values[call++] ?? 0)?.id, 'near');
});
