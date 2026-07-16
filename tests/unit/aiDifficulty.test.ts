import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageAiDifficulty,
  clearRuntimeAiDifficulties,
  getAiDifficultyBadgeLabel,
  getEffectiveAiDifficulty,
  getRuntimeAiDifficultyForSeat,
  replaceRuntimeAiDifficulties,
  setCurrentAiRollDifficulty,
} from '../../src/game-core/aiDifficulty.js';
import { chooseAiRollTimingZone } from '../../src/game-core/roll.js';

test('substituted players always use hard AI difficulty', () => {
  assert.equal(getEffectiveAiDifficulty({ aiDifficulty: 'easy', isSubstitutedByAI: true }), 'hard');
  assert.equal(getEffectiveAiDifficulty({ aiDifficulty: 'easy', isSubstitutedByAI: false }), 'easy');
  assert.equal(getEffectiveAiDifficulty(undefined), 'hard');
});

test('AI difficulty badge defaults to hard and includes the difficulty text', () => {
  assert.equal(getAiDifficultyBadgeLabel(undefined), '어려움 AI');
  assert.equal(getAiDifficultyBadgeLabel('hard'), '어려움 AI');
  assert.equal(getAiDifficultyBadgeLabel('easy'), '쉬움 AI');
  assert.equal(getAiDifficultyBadgeLabel({ aiDifficulty: 'easy', isSubstitutedByAI: true }), '어려움 AI');
});

test('only the host can manage a normal AI seat difficulty', () => {
  assert.equal(canManageAiDifficulty(true, { isAI: true }), true);
  assert.equal(canManageAiDifficulty(false, { isAI: true }), false);
  assert.equal(canManageAiDifficulty(true, { isAI: false }), false);
  assert.equal(canManageAiDifficulty(true, { isAI: true, isSubstitutedByAI: true }), false);
});

test('runtime difficulty is kept per AI seat', () => {
  replaceRuntimeAiDifficulties([
    { id: 'easy-ai', aiDifficulty: 'easy' },
    { id: 'left-player', aiDifficulty: 'easy', isSubstitutedByAI: true },
  ]);
  assert.equal(getRuntimeAiDifficultyForSeat('easy-ai'), 'easy');
  assert.equal(getRuntimeAiDifficultyForSeat('left-player'), 'hard');
  assert.equal(getRuntimeAiDifficultyForSeat('missing'), 'hard');
  clearRuntimeAiDifficulties();
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
