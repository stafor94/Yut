import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGameStatistics,
  formatStatisticsPercentage,
  resolveGameStatisticsSeats,
  selectCurrentGameSequences,
  type GameStatisticsSequence,
} from '../../src/app/flows/gameStatistics';

const seats = [
  { id: 'p1', label: 'P1', name: '무상', seatIndex: 0, isAI: false },
  { id: 'p2', label: 'P2', name: 'AI 단풍', seatIndex: 1, isAI: true },
];

const sequence = (
  sequenceNumber: number,
  type: GameStatisticsSequence['type'],
  actorId: string,
  payload: Record<string, unknown> = {},
  actionPayload: Record<string, unknown> = {},
): GameStatisticsSequence => ({
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
    stateAfter: { gameSeats: stateSeats },
  }]);
  assert.deepEqual(fromSequence.map((seat) => seat.name), ['첫째', '둘째']);
});

test('두 번째 게임에서는 같은 actor ID의 이전 roll과 capture를 집계하지 않는다', () => {
  const sequences = [
    sequence(1, 'game_initialized', 'p1', { startRequestVersion: 1, startRequestId: 'game-1' }),
    sequence(2, 'roll_yut', 'p1', { timingZone: 'perfect', rollName: '모' }),
    sequence(3, 'move_piece_resolved', 'p1', { capturedPieceIds: ['old-piece-1', 'old-piece-2'] }),
    sequence(10, 'game_initialized', 'p1', { startRequestVersion: 2, startRequestId: 'game-2' }),
    sequence(11, 'roll_yut', 'p1', { timingZone: 'nice', rollName: '개' }),
    sequence(12, 'move_piece_resolved', 'p1', { capturedPieceIds: ['current-piece'] }),
  ];
  const current = selectCurrentGameSequences({ startRequestVersion: 2, startRequestId: 'game-2', lastSequence: 12 }, sequences);
  const [statistics] = buildGameStatistics(current, seats.slice(0, 1));

  assert.deepEqual(current.map((entry) => entry.sequence), [10, 11, 12]);
  assert.deepEqual(statistics.rolls.map((roll) => roll.sequence), [11]);
  assert.equal(statistics.timing.find((entry) => entry.label === 'NICE')?.count, 1);
  assert.equal(statistics.timing.find((entry) => entry.label === 'PERFECT')?.count, 0);
  assert.equal(statistics.capturedPieceCount, 1);
});

test('현재 게임에 roll이 아직 없으면 이전 게임 기록 대신 0건을 반환한다', () => {
  const sequences = [
    sequence(1, 'game_initialized', 'p1', { startRequestId: 'game-1' }),
    sequence(2, 'roll_yut', 'p1', { timingZone: 'perfect', rollName: '모' }),
    sequence(10, 'game_initialized', 'p1', { startRequestId: 'game-2' }),
    sequence(11, 'race_continued', 'p1'),
  ];
  const current = selectCurrentGameSequences({ startRequestId: 'game-2', lastSequence: 11 }, sequences);
  const [statistics] = buildGameStatistics(current, seats.slice(0, 1));

  assert.deepEqual(current.map((entry) => entry.sequence), [10, 11]);
  assert.equal(statistics.totalRolls, 0);
  assert.equal(statistics.capturedPieceCount, 0);
});

test('startRequest identity는 payload, patch와 legacy stateAfter 저장 형식에서 모두 탐색한다', () => {
  const sequences: GameStatisticsSequence[] = [
    { ...sequence(1, 'game_initialized', 'p1'), patch: { startRequestVersion: 1, startRequestId: 'patch-game' } },
    sequence(2, 'roll_yut', 'p1', { rollName: '도' }),
    { ...sequence(10, 'game_initialized', 'p1'), stateAfter: { startRequestVersion: 2, startRequestId: 'state-game' } },
    sequence(11, 'roll_yut', 'p1', { rollName: '개' }),
  ];

  assert.deepEqual(
    selectCurrentGameSequences({ startRequestId: 'patch-game', startRequestVersion: 1, lastSequence: 2 }, sequences).map((entry) => entry.sequence),
    [1, 2],
  );
  assert.deepEqual(
    selectCurrentGameSequences({ startRequestId: 'state-game', startRequestVersion: 2, lastSequence: 11 }, sequences).map((entry) => entry.sequence),
    [10, 11],
  );
});

test('입력 순서와 관계없이 sequence 번호로 현재 게임 경계를 안정적으로 계산한다', () => {
  const sequences = [
    sequence(12, 'move_piece_resolved', 'p1', { captured: true }),
    sequence(2, 'roll_yut', 'p1', { rollName: '모' }),
    sequence(10, 'game_initialized', 'p1', { startRequestId: 'game-2' }),
    sequence(1, 'game_initialized', 'p1', { startRequestId: 'game-1' }),
    sequence(11, 'roll_yut', 'p1', { rollName: '도' }),
  ];

  assert.deepEqual(
    selectCurrentGameSequences({ startRequestId: 'game-2' }, sequences).map((entry) => entry.sequence),
    [10, 11, 12],
  );
});

test('legacy 데이터는 최신 game_initialized를 경계로 사용하고 초기화가 없으면 전체를 유지한다', () => {
  const withLegacyBoundaries = [
    sequence(1, 'game_initialized', 'p1'),
    sequence(2, 'roll_yut', 'p1', { rollName: '모' }),
    sequence(8, 'game_initialized', 'p1'),
    sequence(9, 'roll_yut', 'p1', { rollName: '도' }),
  ];
  const withoutBoundary = [
    sequence(3, 'roll_yut', 'p1', { rollName: '도' }),
    sequence(4, 'move_piece_resolved', 'p1', { captured: true }),
  ];

  assert.deepEqual(selectCurrentGameSequences(undefined, withLegacyBoundaries).map((entry) => entry.sequence), [8, 9]);
  assert.deepEqual(selectCurrentGameSequences(undefined, withoutBoundary).map((entry) => entry.sequence), [3, 4]);
});

test('race_continued는 새 게임 경계가 아니며 같은 game_initialized 이후 통계를 유지한다', () => {
  const sequences = [
    sequence(10, 'game_initialized', 'p1', { startRequestId: 'game-2' }),
    sequence(11, 'roll_yut', 'p1', { timingZone: 'good', rollName: '걸' }),
    sequence(12, 'race_continued', 'p1'),
    sequence(13, 'roll_yut', 'p1', { timingZone: 'nice', rollName: '개' }),
  ];
  const current = selectCurrentGameSequences({ startRequestId: 'game-2', lastSequence: 13 }, sequences);
  const [statistics] = buildGameStatistics(current, seats.slice(0, 1));

  assert.deepEqual(current.map((entry) => entry.sequence), [10, 11, 12, 13]);
  assert.deepEqual(statistics.rolls.map((roll) => roll.sequence), [13, 11]);
});

test('현재 게임 좌석 폴백은 이전 게임 stateAfter를 사용하지 않는다', () => {
  const oldSeats = [{ id: 'old-player', label: 'P1', name: '이전 사용자', seatIndex: 0, isAI: false }];
  const newSeats = [{ id: 'new-player', label: 'P1', name: '현재 사용자', seatIndex: 0, isAI: false }];
  const sequences: GameStatisticsSequence[] = [
    { ...sequence(1, 'game_initialized', 'old-player', { startRequestId: 'game-1' }), stateAfter: { gameSeats: oldSeats } },
    { ...sequence(2, 'state_snapshot', 'old-player'), stateAfter: { gameSeats: oldSeats } },
    { ...sequence(10, 'game_initialized', 'new-player', { startRequestId: 'game-2' }), stateAfter: { gameSeats: newSeats } },
  ];

  const result = resolveGameStatisticsSeats({ startRequestId: 'game-2' }, sequences);

  assert.deepEqual(result.map((seat) => seat.id), ['new-player']);
});
