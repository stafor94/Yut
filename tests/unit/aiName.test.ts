import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_NAME_BASES, AI_NAME_PREFIXES } from '../../src/app/constants/playerPresentation.js';
import { makeUniqueAIName } from '../../src/app/flows/aiName.js';

test('waiting room AI uses an unused adjective and zodiac animal name', () => {
  const name = makeUniqueAIName([
    { name: `${AI_NAME_PREFIXES[0]} ${AI_NAME_BASES[0]}`, isEmpty: false },
    { name: '빈 자리', isEmpty: true },
  ], () => 0);

  assert.equal(name, `${AI_NAME_PREFIXES[1]} ${AI_NAME_BASES[0]}`);
  assert.ok(AI_NAME_PREFIXES.some((prefix) => name.startsWith(`${prefix} `)));
  assert.ok(AI_NAME_BASES.some((base) => name.endsWith(` ${base}`)));
});

test('waiting room AI falls back only after every adjective and zodiac name is used', () => {
  const occupied = AI_NAME_BASES.flatMap((base) => AI_NAME_PREFIXES.map((prefix) => ({
    name: `${prefix} ${base}`,
    isEmpty: false,
  })));

  assert.equal(makeUniqueAIName(occupied, () => 0), 'AI 친구 1');
});
