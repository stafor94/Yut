import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseAiRollTimingZone,
  getFallChanceForTimingZone,
  getRollFallCountForTimingZone,
  getRollFallCountRange,
  getRollTimingPositionPercent,
  getRollTimingZone,
  getYutResultProbabilitiesForTiming,
  normalizeRollFallCount,
  normalizeRollTimingZone,
  rollYutResultWithTiming,
  type RollTimingGrade,
} from '../../src/game-core/roll';

const sequenceRandom = (...values: number[]) => {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? 0;
};

test('화면의 2초 왕복 주기와 타이밍 위치 계산이 일치한다', () => {
  assert.equal(getRollTimingPositionPercent(0), 0);
  assert.equal(getRollTimingPositionPercent(500), 50);
  assert.equal(getRollTimingPositionPercent(1000), 100);
  assert.equal(getRollTimingPositionPercent(1500), 50);
  assert.equal(getRollTimingPositionPercent(2000), 0);
});

test('Perfect, Nice, Good, Bad 경계값을 빠짐없이 판정한다', () => {
  const cases: Array<[number, RollTimingGrade]> = [
    [0, 'bad'], [19.999, 'bad'], [20, 'good'], [39.999, 'good'],
    [40, 'nice'], [44.999, 'nice'], [45, 'perfect'], [55, 'perfect'],
    [55.001, 'nice'], [60, 'nice'], [60.001, 'good'], [80, 'good'],
    [80.001, 'bad'], [100, 'bad'],
  ];
  cases.forEach(([position, expected]) => assert.equal(getRollTimingZone(position), expected, `${position}%`));
});

test('타이밍 등급별 낙 확률은 Perfect 0%, Nice 5%, Good 20%, Bad 70%다', () => {
  assert.equal(getFallChanceForTimingZone('perfect'), 0);
  assert.equal(getFallChanceForTimingZone('nice'), 0.05);
  assert.equal(getFallChanceForTimingZone('good'), 0.2);
  assert.equal(getFallChanceForTimingZone('bad'), 0.7);
});

test('Nice 낙은 항상 1개이고 Good·Bad 낙은 등급별 경계 개수를 사용한다', () => {
  assert.deepEqual(getRollFallCountRange('nice'), [1, 1]);
  assert.equal(getRollFallCountForTimingZone('nice', () => 0), 1);
  assert.equal(getRollFallCountForTimingZone('nice', () => 0.999999), 1);

  assert.deepEqual(getRollFallCountRange('good'), [1, 2]);
  assert.equal(getRollFallCountForTimingZone('good', () => 0), 1);
  assert.equal(getRollFallCountForTimingZone('good', () => 0.999999), 2);

  assert.deepEqual(getRollFallCountRange('bad'), [2, 4]);
  assert.equal(getRollFallCountForTimingZone('bad', () => 0), 2);
  assert.equal(getRollFallCountForTimingZone('bad', () => 0.999999), 4);
});

test('허용 범위를 벗어나거나 비정상적인 낙 개수는 게임을 중단하지 않고 등급 범위로 정규화한다', () => {
  assert.equal(normalizeRollFallCount('nice', -3), 1);
  assert.equal(normalizeRollFallCount('nice', 9), 1);
  assert.equal(normalizeRollFallCount('good', -3), 1);
  assert.equal(normalizeRollFallCount('good', 9), 2);
  assert.equal(normalizeRollFallCount('bad', -3), 2);
  assert.equal(normalizeRollFallCount('bad', 9), 4);
  assert.equal(normalizeRollFallCount('bad', Number.NaN), 2);
  assert.equal(normalizeRollFallCount('bad', '3.9'), 3);
});

test('레거시 Normal은 새 등급을 추가하지 않고 Bad 확률과 기존 1~4개 낙 계약을 유지한다', () => {
  assert.equal(normalizeRollTimingZone('normal'), 'bad');
  assert.equal(getFallChanceForTimingZone('normal'), 0.7);
  assert.deepEqual(getRollFallCountRange('normal'), [1, 4]);
  assert.equal(getRollFallCountForTimingZone('normal', () => 0), 1);
  assert.equal(getRollFallCountForTimingZone('normal', () => 0.999999), 4);
  assert.equal(normalizeRollFallCount('normal', 0), 1);
  assert.equal(normalizeRollFallCount('normal', 8), 4);
  const values = [0.2, 0.8, 0.2, 0.8];
  assert.deepEqual(
    rollYutResultWithTiming('normal', sequenceRandom(...values)),
    rollYutResultWithTiming('bad', sequenceRandom(...values)),
  );
});

test('쉬움 AI는 10/20/50/20 비율의 경계로 등급을 고른다', () => {
  assert.equal(chooseAiRollTimingZone('easy', () => 0.0999), 'perfect');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.1), 'nice');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.2999), 'nice');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.3), 'good');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.7999), 'good');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.8), 'bad');
});

test('어려움 AI는 60/25/10/5 비율의 경계로 등급을 고른다', () => {
  assert.equal(chooseAiRollTimingZone('hard', () => 0.5999), 'perfect');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.6), 'nice');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.8499), 'nice');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.85), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.9499), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.95), 'bad');
});

test('Nice, Good, Bad는 같은 일반 윷 결과 확률 경로를 사용한다', () => {
  const values = [0.2, 0.8, 0.2, 0.8];
  const nice = rollYutResultWithTiming('nice', sequenceRandom(...values));
  const good = rollYutResultWithTiming('good', sequenceRandom(...values));
  const bad = rollYutResultWithTiming('bad', sequenceRandom(...values));
  assert.deepEqual(nice, good);
  assert.deepEqual(good, bad);
});

test('게임 방법에 표시할 윷 결과 확률은 실제 일반·Perfect 분포와 합계가 일치한다', () => {
  const standard = getYutResultProbabilitiesForTiming('nice');
  const perfect = getYutResultProbabilitiesForTiming('perfect');
  assert.deepEqual(
    standard.map(({ name, probability }) => [name, probability]),
    [
      ['빽도', 0.0625],
      ['도', 0.1875],
      ['개', 0.375],
      ['걸', 0.25],
      ['윷', 0.0625],
      ['모', 0.0625],
    ],
  );
  assert.deepEqual(
    perfect.map(({ name, probability }) => [name, Number(probability.toFixed(8))]),
    [
      ['빽도', 0.05535714],
      ['도', 0.16607143],
      ['개', 0.33214286],
      ['걸', 0.22142857],
      ['윷', 0.1125],
      ['모', 0.1125],
    ],
  );
  assert.equal(Number(standard.reduce((sum, entry) => sum + entry.probability, 0).toFixed(8)), 1);
  assert.equal(Number(perfect.reduce((sum, entry) => sum + entry.probability, 0).toFixed(8)), 1);
});

test('Perfect의 기존 윷·모 강화 결과 경계를 유지한다', () => {
  assert.equal(rollYutResultWithTiming('perfect', () => 0.88).result.name, '윷');
  assert.equal(rollYutResultWithTiming('perfect', () => 0.95).result.name, '모');
});
