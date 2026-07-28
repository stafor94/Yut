import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDisplaySticks, type YutResult } from '../../src/game-core/roll.js';
import {
  aggregateTurnOrderRound,
  createTurnOrderIntro,
  makeTurnOrderSubmissionId,
  submitTurnOrderResult,
  TURN_ORDER_INITIAL_DELAY_MS,
  TURN_ORDER_ROUND_DURATION_MS,
  type TurnOrderSubmission,
} from '../../src/app/flows/turnOrderFlow.js';

const seats = [
  { id: 'p1', label: 'P1', name: '하나', color: 'red', team: '청팀' as const },
  { id: 'p2', label: 'P2', name: '둘', color: 'blue', team: '홍팀' as const },
];

const makeSubmission = (roundId: string, seatId: string, submittedAt: number): TurnOrderSubmission => {
  const displayResult: YutResult = { name: '도', steps: 1 };
  return {
    submissionId: makeTurnOrderSubmissionId(roundId, seatId),
    seatId,
    roundId,
    resultName: '도',
    displayResult,
    sticks: makeDisplaySticks(displayResult),
    fallCount: 0,
    timingZone: 'normal',
    source: 'manual',
    submittedAt,
  };
};

test('순서 정하기 첫 라운드와 재대결은 5초 제한시간을 사용하고 시작 준비 8초는 유지한다', () => {
  const now = 1_000;
  let intro = createTurnOrderIntro(seats, {
    roomId: 'room-duration',
    startRequestVersion: 1,
    playMode: 'individual',
    now,
    getSeatPieceColor: (seat) => seat.color,
  }).intro;

  assert.equal(TURN_ORDER_INITIAL_DELAY_MS, 8_000);
  assert.equal(intro.currentRound.startAt - now, TURN_ORDER_INITIAL_DELAY_MS);
  assert.equal(TURN_ORDER_ROUND_DURATION_MS, 5_000);
  assert.equal(intro.currentRound.deadlineAt - intro.currentRound.startAt, 5_000);

  const submittedAt = intro.currentRound.startAt + 500;
  intro = submitTurnOrderResult(intro, makeSubmission(intro.currentRound.id, 'p1', submittedAt), submittedAt);
  intro = submitTurnOrderResult(intro, makeSubmission(intro.currentRound.id, 'p2', submittedAt), submittedAt);
  intro = aggregateTurnOrderRound(intro, submittedAt + 100);

  assert.ok(intro.nextRound);
  assert.equal(Number(intro.nextRound?.deadlineAt) - Number(intro.nextRound?.startAt), 5_000);
});
