import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDisplaySticks, type YutResult } from '../../src/game-core/roll.js';
import {
  aggregateTurnOrderRound,
  aggregateTurnOrderRoundFromStoredSubmissions,
  createTurnOrderIntro,
  makeTurnOrderSubmissionId,
  submitTurnOrderResult,
  type TurnOrderIntro,
  type TurnOrderResultName,
  type TurnOrderSubmission,
} from '../../src/app/flows/turnOrderFlow.js';

const seats = [
  { id: 'p1', label: 'P1', name: '사람', color: 'red', team: '청팀' as const },
  { id: 'p2', label: 'P2', name: 'AI 1', color: 'blue', team: '홍팀' as const, isAI: true },
  { id: 'p3', label: 'P3', name: 'AI 2', color: 'green', team: '청팀' as const, isAI: true },
];

const resultFromName = (name: Exclude<TurnOrderResultName, '낙'>): YutResult => {
  if (name === '빽도') return { name, steps: -1 };
  const steps = { 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 5 }[name];
  return { name, steps, ...(name === '윷' || name === '모' ? { bonus: true } : {}) };
};

const submission = (
  roundId: string,
  seatId: string,
  resultName: TurnOrderResultName,
  submittedAt: number,
  source: TurnOrderSubmission['source'] = 'auto',
): TurnOrderSubmission => {
  const displayResult = resultName === '낙' ? { name: '도' as const, steps: 1 } : resultFromName(resultName);
  return {
    submissionId: makeTurnOrderSubmissionId(roundId, seatId),
    seatId,
    roundId,
    resultName,
    displayResult,
    sticks: makeDisplaySticks(displayResult),
    fallCount: resultName === '낙' ? 2 : 0,
    timingZone: 'normal',
    source,
    submittedAt,
  };
};

const createAiRematchIntro = () => {
  let intro = createTurnOrderIntro(seats, {
    roomId: 'room-ai-rematch',
    startRequestVersion: 7,
    playMode: 'individual',
    startAt: 1_000,
    getSeatPieceColor: (seat) => seat.color,
  }).intro;
  const firstRoundId = intro.currentRound.id;
  intro = submitTurnOrderResult(intro, submission(firstRoundId, 'p1', '모', 1_500, 'manual'), 1_500);
  intro = submitTurnOrderResult(intro, submission(firstRoundId, 'p2', '도', 1_500), 1_500);
  intro = submitTurnOrderResult(intro, submission(firstRoundId, 'p3', '도', 1_500), 1_500);
  return aggregateTurnOrderRound(intro, 1_600);
};

test('다음 AI 재대결 제출이 authoritative 라운드 활성화보다 먼저 준비돼도 한 계산에서 활성화하고 집계한다', () => {
  const authoritative = createAiRematchIntro();
  const nextRound = authoritative.nextRound;
  assert.ok(nextRound);
  assert.equal(authoritative.currentRound.status, 'reveal-pending');
  assert.deepEqual(authoritative.placements, { p1: 1 });
  assert.deepEqual(nextRound.eligibleSeatIds, ['p2', 'p3']);

  const transactionNow = nextRound.startAt + 100;
  const storedSubmissions = [
    submission(nextRound.id, 'p2', '걸', transactionNow),
    submission(nextRound.id, 'p3', '개', transactionNow),
  ];
  const aggregated = aggregateTurnOrderRoundFromStoredSubmissions(
    authoritative,
    { sessionId: authoritative.sessionId, roundId: nextRound.id },
    storedSubmissions,
    transactionNow,
  );

  assert.equal(aggregated.currentRound.id, nextRound.id);
  assert.equal(aggregated.currentRound.status, 'reveal-pending');
  assert.equal(aggregated.currentRound.aggregatedAt, transactionNow);
  assert.ok(transactionNow < aggregated.currentRound.deadlineAt);
  assert.deepEqual(aggregated.placements, { p1: 1, p2: 2, p3: 3 });
  assert.deepEqual(aggregated.finalIndividualOrderIds, ['p1', 'p2', 'p3']);
  assert.deepEqual(aggregated.finalTurnOrderIds, ['p1', 'p2', 'p3']);

  const repeated = aggregateTurnOrderRoundFromStoredSubmissions(
    aggregated,
    { sessionId: aggregated.sessionId, roundId: nextRound.id },
    storedSubmissions,
    transactionNow + 1,
  );
  assert.strictEqual(repeated, aggregated);
});

test('일부 제출, 중복 좌석 제출, 오래된 session 또는 round는 재대결 활성화나 집계를 만들지 않는다', () => {
  const authoritative = createAiRematchIntro();
  const nextRound = authoritative.nextRound;
  assert.ok(nextRound);
  const transactionNow = nextRound.startAt + 100;
  const p2 = submission(nextRound.id, 'p2', '걸', transactionNow);

  const partial = aggregateTurnOrderRoundFromStoredSubmissions(
    authoritative,
    { sessionId: authoritative.sessionId, roundId: nextRound.id },
    [p2],
    transactionNow,
  );
  assert.strictEqual(partial, authoritative);

  const duplicateSeat = aggregateTurnOrderRoundFromStoredSubmissions(
    authoritative,
    { sessionId: authoritative.sessionId, roundId: nextRound.id },
    [p2, { ...p2, resultName: '모', displayResult: resultFromName('모') }],
    transactionNow,
  );
  assert.strictEqual(duplicateSeat, authoritative);

  const staleSession = aggregateTurnOrderRoundFromStoredSubmissions(
    authoritative,
    { sessionId: 'old-session', roundId: nextRound.id },
    [p2, submission(nextRound.id, 'p3', '개', transactionNow)],
    transactionNow,
  );
  assert.strictEqual(staleSession, authoritative);

  const staleRound = aggregateTurnOrderRoundFromStoredSubmissions(
    authoritative,
    { sessionId: authoritative.sessionId, roundId: 'old-round' },
    [p2, submission(nextRound.id, 'p3', '개', transactionNow)],
    transactionNow,
  );
  assert.strictEqual(staleRound, authoritative);
});
