import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameSequence } from '../../src/features/room/services/roomService';
import {
  buildGameStatistics,
  formatStatisticsPercentage,
  resolveGameStatisticsSeats,
} from '../../src/app/flows/gameStatistics';

const seats = [
  { id: 'p1', label: 'P1', name: '무상', seatIndex: 0, isAI: false },
  { id: 'p2', label: 'P2', name: 'AI 단풍', seatIndex: 1, isAI: true },
];

const sequence = (
  sequenceNumber: number,
  type: GameSequence['type'],
  actorId: string,
  payload: Record<string, unknown> = {},
  actionPayload: Record<string, unknown> = {},
): GameSequence => ({
  id: `seq-${sequenceNumber}`,
  sequence: sequenceNumber,
  type,
  actorId,
  payload,
  action: actionPayload ? { type: type === 'move_piece_resolved' ? 'move_piece' : 'roll_yut', actorId, payload: actionPayload } : null,
});

test('플레이어별 roll_yut 기록만 분리하고 Sequence 번호 내림차순으로 정렬한다', () => {
  const result = buildGameStatistics([
    sequence(2, 'roll_yut', 'p2', { timingZone: 'nice', rollName: '개' }),
    sequence(5, 'roll_yut', 'p1', { timingZone: 'perfect', rollName: '모' }),
    sequence(3, 'roll_yut', 'p1', { timingZone: 'good', rollName: '도' }),
    sequence(4, 'move_piece_resolved', 'p1', { captured: false }),
  ], seats);

  assert.deepEqual(result[0].rolls.map((roll) => roll.sequence), [5, 3]);
  assert.deepEqual(result[1].rolls.map((roll) => roll.sequence), [2]);
});

test('타이밍 결과 개수와 퍼센티지를 계산하고 normal은 BAD로 호환한다', () => {
  const [result] = buildGameStatistics([
    sequence(1, 'roll_yut', 'p1', { timingZone: 'perfect', rollName: '도' }),
    sequence(2, 'roll_yut', 'p1', { timingZone: 'nice', rollName: '개' }),
    sequence(3, 'roll_yut', 'p1', { timingZone: 'good', rollName: '걸' }),
    sequence(4, 'roll_yut', 'p1', { timingZone: 'normal', rollName: '윷' }),
    sequence(5, 'roll_yut', 'p1', { timingZone: 'legacy', rollName: '모' }),
  ], seats.slice(0, 1));

  assert.deepEqual(result.timing.map(({ label, count }) => [label, count]), [
    ['PERFECT', 1],
    ['NICE', 1],
    ['GOOD', 1],
    ['BAD', 1],
    ['미확인', 1],
  ]);
  assert.equal(result.timing.find((entry) => entry.label === 'BAD')?.percentage, 20);
  assert.equal(formatStatisticsPercentage(100 / 3), '33.3%');
});

test('낙과 황금 윷의 실제 확정 결과 및 누락 결과를 집계한다', () => {
  const [result] = buildGameStatistics([
    sequence(1, 'roll_yut', 'p1', { timingZone: 'bad', fallOccurred: true, displayRoll: { name: '모' } }),
    sequence(2, 'roll_yut', 'p1', { timingZone: 'perfect', displayRoll: { name: '빽도' } }, { selectedGoldenYutResult: { name: '빽도' } }),
    sequence(3, 'roll_yut', 'p1', { timingZone: 'good' }),
  ], seats.slice(0, 1));

  assert.deepEqual(result.rolls.map((roll) => roll.result), ['미확인', '빽도', '낙']);
  assert.equal(result.yut.find((entry) => entry.label === '낙')?.count, 1);
  assert.equal(result.yut.find((entry) => entry.label === '빽도')?.count, 1);
  assert.equal(result.yut.find((entry) => entry.label === '미확인')?.count, 1);
});

test('기록이 없으면 모든 퍼센티지는 0이고 NaN이나 Infinity가 없다', () => {
  const [result] = buildGameStatistics([], seats.slice(0, 1));

  assert.equal(result.totalRolls, 0);
  assert.ok([...result.timing, ...result.yut].every((entry) => entry.percentage === 0 && Number.isFinite(entry.percentage)));
  assert.equal(formatStatisticsPercentage(Number.NaN), '0%');
});

test('잡힌 말 ID 개수를 합산하고 레거시 captured=true는 1회로 보존한다', () => {
  const result = buildGameStatistics([
    sequence(1, 'move_piece_resolved', 'p1', { captured: true, capturedPieceIds: ['p2-piece-1', 'p2-piece-2'] }),
    sequence(2, 'move_piece_resolved', 'p1', { captured: true, capturedPieceIds: ['p2-piece-3'] }),
    sequence(3, 'move_piece_resolved', 'p1', { captured: true }),
    sequence(4, 'move_piece_resolved', 'p2', { captured: true, capturedPieceIds: ['p1-piece-1'] }),
  ], seats);

  assert.equal(result[0].capturedPieceCount, 4);
  assert.equal(result[1].capturedPieceCount, 1);
});

test('최신 상태의 좌석 순서를 우선하고 Sequence stateAfter를 폴백으로 사용한다', () => {
  const stateSeats = [
    { id: 'p2', label: 'P2', name: '둘째', color: 'blue', team: '홍팀' as const, seatIndex: 1, isAI: true },
    { id: 'p1', label: 'P1', name: '첫째', color: 'red', team: '청팀' as const, seatIndex: 0 },
  ];
  const fromLatest = resolveGameStatisticsSeats({ gameSeats: stateSeats }, []);
  assert.deepEqual(fromLatest.map((seat) => seat.id), ['p1', 'p2']);

  const fromSequence = resolveGameStatisticsSeats(null, [{
    ...sequence(7, 'state_snapshot', 'p1'),
    stateAfter: { gameSeats: stateSeats } as never,
  }]);
  assert.deepEqual(fromSequence.map((seat) => seat.name), ['첫째', '둘째']);
});
