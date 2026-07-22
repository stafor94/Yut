import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_NICKNAME_CANDIDATES, getRandomAiNickname, makeUniqueAIName } from '../../src/app/flows/aiName';

const firstRandom = () => 0;
const easyNames = new Set(AI_NICKNAME_CANDIDATES.easy);
const hardNames = new Set(AI_NICKNAME_CANDIDATES.hard);

test('쉬움 난이도 AI 닉네임은 쉬움 후보군에서만 반환된다', () => {
  const nickname = getRandomAiNickname('easy', [], firstRandom);

  assert.ok(easyNames.has(nickname));
  assert.ok(!hardNames.has(nickname));
});

test('어려움 난이도 AI 닉네임은 어려움 후보군에서만 반환된다', () => {
  const nickname = getRandomAiNickname('hard', [], firstRandom);

  assert.ok(hardNames.has(nickname));
  assert.ok(!easyNames.has(nickname));
});

test('저장된 AI 객체를 다시 읽는 경로는 기존 닉네임 값을 그대로 사용한다', () => {
  const storedAi = { nickname: '말판장인', aiDifficulty: 'hard' as const };

  assert.equal(storedAi.nickname, '말판장인');
});

test('같은 난이도 후보가 남아 있으면 이미 사용 중인 AI 닉네임을 피한다', () => {
  const usedSeats = AI_NICKNAME_CANDIDATES.hard.slice(0, -1).map((name, index) => ({
    name,
    isEmpty: false,
    label: `P${index + 1}`,
  }));

  const nickname = makeUniqueAIName(usedSeats, 'hard', firstRandom);

  assert.equal(nickname, AI_NICKNAME_CANDIDATES.hard[AI_NICKNAME_CANDIDATES.hard.length - 1]);
});

test('후보 수보다 AI 수가 많으면 같은 난이도 후보군 안에서만 중복을 허용한다', () => {
  const usedSeats = AI_NICKNAME_CANDIDATES.easy.map((name) => ({ name, isEmpty: false }));
  const nickname = makeUniqueAIName(usedSeats, 'easy', firstRandom);

  assert.ok(easyNames.has(nickname));
});

test('난이도 값이 누락되거나 예상하지 못한 값이어도 기본 어려움 후보군 닉네임을 반환한다', () => {
  const missingDifficultyNickname = getRandomAiNickname(undefined, [], firstRandom);
  const invalidDifficultyNickname = getRandomAiNickname({ aiDifficulty: 'normal' }, [], firstRandom);

  assert.ok(hardNames.has(missingDifficultyNickname));
  assert.ok(hardNames.has(invalidDifficultyNickname));
});
