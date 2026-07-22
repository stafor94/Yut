import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseAiRollTimingZone,
  getFallChanceForTimingZone,
  getRollTimingPositionPercent,
  getRollTimingZone,
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

test('타이밍 등급별 낙 확률을 적용한다', () => {
  assert.equal(getFallChanceForTimingZone('perfect'), 0);
  assert.equal(getFallChanceForTimingZone('nice'), 0.1);
  assert.equal(getFallChanceForTimingZone('good'), 0.2);
  assert.equal(getFallChanceForTimingZone('bad'), 0.6);
});

test('레거시 Normal은 새 등급을 추가하지 않고 Bad로 처리한다', () => {
  assert.equal(normalizeRollTimingZone('normal'), 'bad');
  assert.equal(getFallChanceForTimingZone('normal'), 0.6);
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

test('어려움 AI는 30/40/20/10 비율의 경계로 등급을 고른다', () => {
  assert.equal(chooseAiRollTimingZone('hard', () => 0.2999), 'perfect');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.3), 'nice');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.6999), 'nice');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.7), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.8999), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.9), 'bad');
});

test('Nice, Good, Bad는 같은 일반 윷 결과 확률 경로를 사용한다', () => {
  const values = [0.2, 0.8, 0.2, 0.8];
  const nice = rollYutResultWithTiming('nice', sequenceRandom(...values));
  const good = rollYutResultWithTiming('good', sequenceRandom(...values));
  const bad = rollYutResultWithTiming('bad', sequenceRandom(...values));
  assert.deepEqual(nice, good);
  assert.deepEqual(good, bad);
});

test('Perfect의 기존 윷·모 강화 결과 경계를 유지한다', () => {
  assert.equal(rollYutResultWithTiming('perfect', () => 0.88).result.name, '윷');
  assert.equal(rollYutResultWithTiming('perfect', () => 0.95).result.name, '모');
});
