import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDisplaySticks, type RollTimingZone, type YutResult } from '../../src/game-core/roll.js';
import {
  activateNextTurnOrderRound,
  aggregateTurnOrderRound,
  buildAlternatingTeamTurnOrder,
  canAggregateTurnOrderRound,
  createTurnOrderIntro,
  getTurnOrderScore,
  isTurnOrderFinalized,
  makeTurnOrderSubmissionId,
  submitAndMaybeAggregateTurnOrderRound,
  submitTurnOrderResult,
  TURN_ORDER_PRESENTATION_FINAL_HOLD_MS,
  TURN_ORDER_REVEAL_DELAY_MS,
  TURN_ORDER_RESULT_HOLD_MS,
  TURN_ORDER_ROUND_DURATION_MS,
  type TurnOrderIntro,
  type TurnOrderResultName,
  type TurnOrderSubmission,
} from '../../src/app/flows/turnOrderFlow.js';

const seats = [
  { id: 'p1', label: 'P1', name: '하나', color: 'red', team: '청팀' as const },
  { id: 'p2', label: 'P2', name: '둘', color: 'blue', team: '청팀' as const },
  { id: 'p3', label: 'P3', name: '셋', color: 'green', team: '홍팀' as const },
  { id: 'p4', label: 'P4', name: '넷', color: 'yellow', team: '홍팀' as const },
];

const resultFromName = (name: Exclude<TurnOrderResultName, '낙'>): YutResult => {
  if (name === '빽도') return { name, steps: -1 };
  const steps = { 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 5 }[name];
  return { name, steps, ...(name === '윷' || name === '모' ? { bonus: true } : {}) };
};

const submission = (roundId: string, seatId: string, name: TurnOrderResultName, submittedAt: number, timingZone: RollTimingZone = 'good'): TurnOrderSubmission => {
  const displayResult = name === '낙' ? { name: '도' as const, steps: 1 } : resultFromName(name);
  return {
    submissionId: makeTurnOrderSubmissionId(roundId, seatId),
    roundId,
    seatId,
    resultName: name,
    displayResult,
    sticks: makeDisplaySticks(displayResult),
    fallCount: name === '낙' ? 2 : 0,
    timingZone,
    source: 'manual',
    submittedAt,
  };
};

const createIntro = (playMode: 'individual' | 'team' = 'individual', startAt = 10_000) => createTurnOrderIntro(seats, {
  roomId: 'room-a',
  startRequestVersion: 3,
  playMode,
  startAt,
  getSeatPieceColor: (seat) => seat.color,
}).intro;

const submitRound = (intro: TurnOrderIntro, results: Record<string, TurnOrderResultName>, submittedAt: number) => Object.entries(results)
  .reduce((current, [seatId, name]) => submitTurnOrderResult(current, submission(current.currentRound.id, seatId, name, submittedAt), submittedAt), intro);

const aggregateAfterDeadline = (intro: TurnOrderIntro, offsetMs = 100) => aggregateTurnOrderRound(intro, intro.currentRound.deadlineAt + offsetMs);

test('순서 점수는 모부터 낙까지 확정 규칙을 따른다', () => {
  const roundId = 'round';
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '모', 1)), 5);
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '윷', 1)), 4);
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '걸', 1)), 3);
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '개', 1)), 2);
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '도', 1)), 1);
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '빽도', 1)), -1);
  assert.equal(getTurnOrderScore(submission(roundId, 'p1', '낙', 1)), -2);
});

test('첫 라운드는 모든 참가자에게 같은 8초 제한시간을 준다', () => {
  const intro = createIntro('individual', 12_000);
  assert.equal(intro.currentRound.startAt, 12_000);
  assert.equal(intro.currentRound.deadlineAt, 12_000 + TURN_ORDER_ROUND_DURATION_MS);
  assert.deepEqual(intro.currentRound.eligibleSeatIds, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(intro.currentRound.submissions.length, 0);
});

test('전원이 일찍 제출하면 제한시간 전에도 즉시 집계하고 3초 뒤 공개한다', () => {
  let intro = createIntro('individual', 10_000);
  intro = submitRound(intro, { p1: '모', p2: '걸', p3: '개', p4: '도' }, 11_000);
  const aggregatedAt = 11_500;

  assert.equal(canAggregateTurnOrderRound(intro, intro.currentRound.startAt - 1), false);
  assert.equal(canAggregateTurnOrderRound(intro, aggregatedAt), true);
  assert.ok(aggregatedAt < intro.currentRound.deadlineAt);

  const aggregated = aggregateTurnOrderRound(intro, aggregatedAt);
  assert.equal(aggregated.currentRound.status, 'reveal-pending');
  assert.equal(aggregated.currentRound.aggregatedAt, aggregatedAt);
  assert.equal(aggregated.currentRound.revealAt, aggregatedAt + TURN_ORDER_REVEAL_DELAY_MS);
});

test('마지막 제출은 같은 상태 전환에서 저장과 집계를 함께 완료한다', () => {
  let intro = createIntro('individual', 10_000);
  intro = submitRound(intro, { p1: '모', p2: '걸', p3: '개' }, 11_000);
  const finalSubmission = submission(intro.currentRound.id, 'p4', '도', 11_500);
  const next = submitAndMaybeAggregateTurnOrderRound(intro, finalSubmission, 11_500);

  assert.equal(finalSubmission.submissionId, `${intro.currentRound.id}:p4`);
  assert.equal(next.currentRound.submissions.length, 4);
  assert.equal(next.currentRound.status, 'reveal-pending');
  assert.equal(next.currentRound.aggregatedAt, 11_500);
  assert.equal(next.currentRound.revealAt, 11_500 + TURN_ORDER_REVEAL_DELAY_MS);
});

test('일부 참가자가 미제출이면 제한시간이 지나도 결과를 집계하지 않는다', () => {
  let intro = createIntro('individual', 10_000);
  intro = submitRound(intro, { p1: '모', p2: '걸', p3: '개' }, 11_000);
  const afterDeadline = intro.currentRound.deadlineAt + 100;

  assert.equal(canAggregateTurnOrderRound(intro, afterDeadline), false);
  assert.deepEqual(aggregateTurnOrderRound(intro, afterDeadline), intro);
});

test('같은 결과별로 독립된 재대결 bracket을 만들고 확정 순위 구간을 보존한다', () => {
  let intro = createIntro();
  intro = submitRound(intro, { p1: '모', p2: '개', p3: '모', p4: '개' }, 18_000);
  intro = aggregateTurnOrderRound(intro, 18_500);

  assert.equal(intro.currentRound.revealAt, 18_500 + TURN_ORDER_REVEAL_DELAY_MS);
  assert.deepEqual(intro.nextRound?.brackets.map((bracket) => ({ rankStart: bracket.rankStart, seatIds: bracket.seatIds })), [
    { rankStart: 1, seatIds: ['p1', 'p3'] },
    { rankStart: 3, seatIds: ['p2', 'p4'] },
  ]);
  assert.equal(intro.nextRound?.startAt, Number(intro.currentRound.revealAt) + TURN_ORDER_RESULT_HOLD_MS);

  intro = activateNextTurnOrderRound(intro, Number(intro.nextRound?.startAt));
  intro = submitRound(intro, { p1: '도', p3: '걸', p2: '빽도', p4: '낙' }, Number(intro.currentRound.startAt) + 500);
  intro = aggregateAfterDeadline(intro);

  assert.equal(isTurnOrderFinalized(intro), true);
  assert.deepEqual(intro.finalIndividualOrderIds, ['p3', 'p1', 'p2', 'p4']);
  assert.deepEqual(intro.finalTurnOrderIds, ['p3', 'p1', 'p2', 'p4']);
  assert.deepEqual(intro.placements, { p3: 1, p1: 2, p2: 3, p4: 4 });
  assert.equal(intro.finalOrderAt, Number(intro.currentRound.revealAt) + TURN_ORDER_RESULT_HOLD_MS);
  assert.equal(intro.gameStartAt, Number(intro.finalOrderAt) + TURN_ORDER_PRESENTATION_FINAL_HOLD_MS);
  assert.equal(intro.readyAt, intro.gameStartAt);
});

test('재대결 라운드 활성화 시 이전 라운드 공개 시각을 초기화한다', () => {
  let intro = createIntro();
  intro = submitRound(intro, { p1: '도', p2: '도', p3: '걸', p4: '개' }, 18_000);
  intro = aggregateAfterDeadline(intro);

  const nextRoundStartAt = Number(intro.nextRound?.startAt);
  const activated = activateNextTurnOrderRound(intro, nextRoundStartAt);
  assert.equal(activated.currentRound.index, 2);
  assert.equal(activated.currentRound.status, 'collecting');
  assert.equal(activated.currentRound.aggregatedAt, 0);
  assert.equal(activated.currentRound.revealAt, 0);
});

test('재대결에서 다시 동률이어도 전원 제출 직후 집계하고 해당 참가자만 다음 라운드로 반복한다', () => {
  const twoSeats = seats.slice(0, 2);
  let intro = createTurnOrderIntro(twoSeats, {
    roomId: 'room-repeat',
    startRequestVersion: 1,
    playMode: 'individual',
    startAt: 1_000,
    getSeatPieceColor: (seat) => seat.color,
  }).intro;

  intro = submitRound(intro, { p1: '도', p2: '도' }, 2_000);
  const firstAggregatedAt = 2_100;
  intro = aggregateTurnOrderRound(intro, firstAggregatedAt);
  assert.ok(firstAggregatedAt < intro.currentRound.deadlineAt);
  assert.equal(intro.currentRound.revealAt, firstAggregatedAt + TURN_ORDER_REVEAL_DELAY_MS);

  intro = activateNextTurnOrderRound(intro, Number(intro.nextRound?.startAt));
  intro = submitRound(intro, { p1: '모', p2: '모' }, Number(intro.currentRound.startAt) + 200);
  const secondAggregatedAt = intro.currentRound.startAt + 300;
  const secondDeadlineAt = intro.currentRound.deadlineAt;
  intro = aggregateTurnOrderRound(intro, secondAggregatedAt);
  assert.ok(secondAggregatedAt < secondDeadlineAt);
  assert.equal(intro.currentRound.revealAt, secondAggregatedAt + TURN_ORDER_REVEAL_DELAY_MS);
  assert.equal(intro.nextRound?.index, 3);
  assert.deepEqual(intro.nextRound?.eligibleSeatIds, ['p1', 'p2']);

  intro = activateNextTurnOrderRound(intro, Number(intro.nextRound?.startAt));
  intro = submitRound(intro, { p1: '걸', p2: '개' }, Number(intro.currentRound.startAt) + 200);
  const thirdAggregatedAt = intro.currentRound.startAt + 300;
  intro = aggregateTurnOrderRound(intro, thirdAggregatedAt);
  assert.deepEqual(intro.finalIndividualOrderIds, ['p1', 'p2']);
});

test('팀전은 개인 1위 팀부터 시작해 팀별로 반드시 번갈아 배치한다', () => {
  const ranked = [seats[0], seats[1], seats[2], seats[3]].map((seat, index) => ({
    seat,
    result: { name: '도' as const, steps: 1 },
    rollOffRound: index + 1,
  }));
  const order = buildAlternatingTeamTurnOrder(ranked);
  assert.deepEqual(order.map((seat) => seat.id), ['p1', 'p3', 'p2', 'p4']);
  assert.deepEqual(order.map((seat) => seat.team), ['청팀', '홍팀', '청팀', '홍팀']);
});

test('중복 제출과 다른 라운드 제출은 상태를 변경하지 않는다', () => {
  const intro = createIntro();
  const first = submission(intro.currentRound.id, 'p1', '걸', 11_000);
  const once = submitTurnOrderResult(intro, first, 11_000);
  const duplicate = submitTurnOrderResult(once, { ...first, resultName: '모' }, 11_100);
  const stale = submitTurnOrderResult(once, { ...first, seatId: 'p2', roundId: 'old-round' }, 11_200);
  assert.deepEqual(duplicate, once);
  assert.deepEqual(stale, once);
});
