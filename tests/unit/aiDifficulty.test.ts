import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEffectiveAiDifficulty,
  setCurrentAiRollDifficulty,
} from '../../src/game-core/aiDifficulty.js';
import { chooseAiRollTimingZone } from '../../src/game-core/roll.js';

test('substituted players always use hard AI difficulty', () => {
  assert.equal(getEffectiveAiDifficulty({ aiDifficulty: 'easy', isSubstitutedByAI: true }), 'hard');
  assert.equal(getEffectiveAiDifficulty({ aiDifficulty: 'easy', isSubstitutedByAI: false }), 'easy');
  assert.equal(getEffectiveAiDifficulty(undefined), 'hard');
});

test('easy AI roll timing uses 20/40/40 boundaries', () => {
  assert.equal(chooseAiRollTimingZone('easy', () => 0.1999), 'perfect');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.2), 'good');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.5999), 'good');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.6), 'normal');
});

test('hard AI roll timing keeps 30/40/30 boundaries', () => {
  assert.equal(chooseAiRollTimingZone('hard', () => 0.2999), 'perfect');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.3), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.6999), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.7), 'normal');
});

test('legacy no-difficulty call reads the active AI difficulty', () => {
  setCurrentAiRollDifficulty('easy');
  assert.equal(chooseAiRollTimingZone(() => 0.25), 'good');
  setCurrentAiRollDifficulty('hard');
  assert.equal(chooseAiRollTimingZone(() => 0.25), 'perfect');
});
