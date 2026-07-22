import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_NICKNAME_CANDIDATES, makeUniqueAIName } from '../../src/app/flows/aiName.js';

test('waiting room AI uses a difficulty-specific nickname without screen prefixes', () => {
  const name = makeUniqueAIName([
    { name: AI_NICKNAME_CANDIDATES.hard[0], isEmpty: false },
    { name: '빈 자리', isEmpty: true },
  ], 'hard', () => 0);

  assert.equal(name, AI_NICKNAME_CANDIDATES.hard[1]);
  assert.ok(!name.startsWith('AI_'));
  assert.ok(!name.startsWith('[AI]'));
});

test('waiting room AI allows duplicates only after every difficulty nickname is used', () => {
  const occupied = AI_NICKNAME_CANDIDATES.easy.map((name) => ({ name, isEmpty: false }));

  assert.equal(makeUniqueAIName(occupied, 'easy', () => 0), AI_NICKNAME_CANDIDATES.easy[0]);
});
