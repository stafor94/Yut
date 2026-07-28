import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameStatistics, formatStatisticPercentage } from '../../src/app/flows/gameStatistics.js';

const players = [
  { id: 'p1', label: 'P1', name: '하나' },
  { id: 'p2', label: 'P2', name: '둘' },
];

const roll = (sequence: number, actorId: string, payload: Record<string, unknown>, actionPayload?: Record<string, unknown>) => ({
  sequence,
  type: 'roll_yut',
  actorId,
  payload,
  action: actionPayload ? { payload: actionPayload } : null,
});

const move = (sequence: number, actorId: string, payload: Record<string, unknown>) => ({
  sequence,
  type: 'move_piece_resolved',
  actorId,
  payload,
});

test('roll_yut 기록은 actorId별로 분리하고 최신 Sequence부터 정렬한다', () => {
  const statistics = createGameStatistics([
    roll(2, 'p1', { timingZone: 'good', rollName: '개' }),
    roll(5, 'p2', { timingZone: 'nice', rollName: '모' }),
    roll(8, 'p1', { timingZone: 'perfect', rollName: '윷' }),
  ], players);

  assert.deepEqual(statistics[0].records.map((record) => record.sequence), [8, 2]);
  assert.deepEqual(statistics[1].records.map((record) => record.sequence), [5]);
  assert.ok(statistics[0].records.every((record) => record.result !== '모'));
});

test('타이밍 결과는 normal을 BAD로 호환하고 누락값은 미확인으로 집계한다', () => {
  const [statistics] = createGameStatistics([
    roll(1, 'p1', { timingZone: 'perfect', rollName: '도' }),
    roll(2, 'p1', { timingZone: 'nice', rollName: '개' }),
    roll(3, 'p1', { timingZone: 'good', rollName: '걸' }),
    roll(4, 'p1', { timingZone: 'normal', rollName: '윷' }),
    roll(5, 'p1', { rollName: '모' }),
  ], players);

  assert.deepEqual(statistics.timing.map(({ label, count, percentage }) => [label, count, percentage]), [
    ['PERFECT', 1, 20],
    ['NICE', 1, 20],
    ['GOOD', 1, 20],
    ['BAD', 1, 20],
    ['미확인', 1, 20],
  ]);
});

test('윷 결과는 낙과 황금 윷의 실제 확정 결과 및 미확인 값을 포함한다', () => {
  const [statistics] = createGameStatistics([
    roll(1, 'p1', { timingZone: 'bad', displayRoll: { name: '도', steps: 1 }, fallOccurred: true }),
    roll(2, 'p1', { timingZone: 'nice', displayRoll: { name: '빽도', steps: -1 } }, { selectedGoldenYutResult: { name: '빽도', steps: -1 } }),
    roll(3, 'p1', { timingZone: 'good', displayRoll: { name: '모', steps: 5 } }, { selectedGoldenYutResult: { name: '모', steps: 5 } }),
    roll(4, 'p1', { timingZone: 'bad' }),
  ], players);

  assert.deepEqual(statistics.records.map((record) => record.result), ['미확인', '모', '빽도', '낙']);
  assert.equal(statistics.results.find((entry) => entry.label === '낙')?.count, 1);
  assert.equal(statistics.results.find((entry) => entry.label === '빽도')?.count, 1);
  assert.equal(statistics.results.find((entry) => entry.label === '모')?.count, 1);
  assert.equal(statistics.results.find((entry) => entry.label === '미확인')?.count, 1);
});

test('퍼센티지 모수는 누락값을 포함한 전체 던지기 횟수이며 최대 소수점 한 자리로 표시한다', () => {
  const [statistics] = createGameStatistics([
    roll(1, 'p1', { timingZone: 'perfect', rollName: '도' }),
    roll(2, 'p1', { timingZone: 'perfect', rollName: '개' }),
    roll(3, 'p1', {}),
  ], players);

  assert.equal(statistics.totalRolls, 3);
  assert.equal(statistics.timing.find((entry) => entry.label === 'PERFECT')?.percentage, 66.7);
  assert.equal(statistics.timing.find((entry) => entry.label === '미확인')?.percentage, 33.3);
  assert.equal(formatStatisticPercentage(66.7), '66.7%');
  assert.equal(formatStatisticPercentage(20), '20%');
});

test('기록이 없으면 모든 퍼센티지가 0%이며 NaN이나 Infinity가 발생하지 않는다', () => {
  const statistics = createGameStatistics([], players);
  statistics.forEach((player) => {
    assert.equal(player.totalRolls, 0);
    [...player.timing, ...player.results].forEach((entry) => {
      assert.equal(entry.percentage, 0);
      assert.ok(Number.isFinite(entry.percentage));
    });
  });
});

test('상대 말 잡기는 capturedPieceIds의 실제 말 개수로 누적한다', () => {
  const [statistics] = createGameStatistics([
    move(1, 'p1', { captured: true, capturedPieceIds: ['p2-piece-1', 'p2-piece-2'] }),
    move(2, 'p1', { captured: true, capturedPieceIds: ['p2-piece-3'] }),
    move(3, 'p2', { captured: true, capturedPieceIds: ['p1-piece-1'] }),
  ], players);

  assert.equal(statistics.captureCount, 3);
});

test('레거시 captured=true 이벤트는 잡힌 말 ID가 없을 때 1회로 보존한다', () => {
  const [statistics] = createGameStatistics([
    move(1, 'p1', { captured: true }),
    move(2, 'p1', { captured: true }),
    move(3, 'p1', { captured: false }),
  ], players);

  assert.equal(statistics.captureCount, 2);
});
