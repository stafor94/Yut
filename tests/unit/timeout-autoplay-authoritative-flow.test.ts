import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
} from '../../src/features/room/services/roomAuthoritativeReducer';

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: false };
const sides = [{ id: 'seat-1', team: '청팀' as const }, { id: 'seat-2', team: '홍팀' as const }];

const makeState = (deadlineAt: number, timeoutCount = 0, autoPlay = false) => {
  const timeoutCountBySeatId: Record<string, number> = timeoutCount ? { 'seat-1': timeoutCount } : {};
  const autoPlayBySeatId: Record<string, boolean> = autoPlay ? { 'seat-1': true } : {};
  return {
    pieces: [
      { id: 'seat-1-piece-1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      { id: 'seat-2-piece-1', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    ],
    turnIndex: 0,
    turnOrderIds: ['seat-1', 'seat-2'],
    initialTurnOrderIds: ['seat-1', 'seat-2'],
    completedSeatIds: [],
    rankingSeatIds: [],
    roll: null,
    rollStack: [],
    rollStackClosed: false,
    logs: [],
    winner: '',
    turnOrderPhase: null,
    turnOrderIntro: null,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    pendingGoldenYutSelection: null,
    itemPromptTiming: null,
    trapNodes: [],
    shieldedPieceIds: [],
    boardItems: [],
    ownedItems: {},
    turnDeadlineAt: deadlineAt,
    turnDeadlineKind: 'roll' as const,
    turnActionTimeoutCountBySeatId: timeoutCountBySeatId,
    autoPlayBySeatId,
    gameSeats: [
      { id: 'seat-1', isAI: false, isSubstitutedByAI: false },
      { id: 'seat-2', isAI: false, isSubstitutedByAI: false },
    ],
  };
};

const makeTimeoutRoll = (deadlineAt: number, id: string) => ({
  type: 'roll_yut' as const,
  actorId: 'seat-1',
  payload: {
    clientActionId: id,
    timedOut: true,
    deadlineAutoSubmitted: true,
    autoSubmittedDeadlineAt: deadlineAt,
    clientActionStartedAt: deadlineAt - 1,
    rollTimingZone: 'bad' as const,
    clientRollResult: { name: '도', steps: 1, bonus: false },
    clientFallOccurred: false,
    clientFallCount: 0,
  },
});

const getCounts = (value: unknown) => value as Record<string, number> | undefined;
const getAutoPlay = (value: unknown) => value as Record<string, boolean> | undefined;

test('실제 timeout action 두 번의 authoritative commit에서 count 1→2와 autoplay가 같은 patch로 전환된다', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 100_100;
    const firstDeadline = 100_000;
    const first = reduceAuthoritativeGameAction(makeState(firstDeadline), makeTimeoutRoll(firstDeadline, 'timeout:first'), room, sides);
    assert.equal(isAuthoritativeCommitReduction(first), true);
    if (!isAuthoritativeCommitReduction(first)) return;
    const firstCounts = getCounts(first.patch.turnActionTimeoutCountBySeatId);
    const firstAutoPlay = getAutoPlay(first.patch.autoPlayBySeatId);
    assert.equal(firstCounts?.['seat-1'], 1);
    assert.notEqual(firstAutoPlay?.['seat-1'], true);

    Date.now = () => 200_100;
    const secondDeadline = 200_000;
    const secondState = {
      ...makeState(secondDeadline, 1),
      turnActionTimeoutCountBySeatId: firstCounts ?? {},
      autoPlayBySeatId: firstAutoPlay ?? {},
    };
    const second = reduceAuthoritativeGameAction(secondState, makeTimeoutRoll(secondDeadline, 'timeout:second'), room, sides);
    assert.equal(isAuthoritativeCommitReduction(second), true);
    if (!isAuthoritativeCommitReduction(second)) return;
    assert.equal(getCounts(second.patch.turnActionTimeoutCountBySeatId)?.['seat-1'], 2);
    assert.equal(getAutoPlay(second.patch.autoPlayBySeatId)?.['seat-1'], true);
  } finally {
    Date.now = originalNow;
  }
});

test('autoplay 전환 후 일반 수동 action은 거부된다', () => {
  const deadlineAt = Date.now() + 10_000;
  const reduction = reduceAuthoritativeGameAction(makeState(deadlineAt, 2, true), {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: {
      clientActionId: 'manual-after-autoplay',
      clientActionStartedAt: Date.now(),
      rollTimingZone: 'bad',
      clientRollResult: { name: '도', steps: 1, bonus: false },
      clientFallOccurred: false,
      clientFallCount: 0,
    },
  }, room, sides);
  assert.equal(reduction.status, 'rejected');
  if (reduction.status !== 'rejected') return;
  assert.match(reduction.reason ?? '', /AI 자동 플레이/);
});

test('timeout AI action은 기존 연속 timeout count를 정상 수동 행동처럼 초기화하지 않는다', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 300_100;
    const deadlineAt = 300_000;
    const baseAction = makeTimeoutRoll(deadlineAt, 'roll_yut_ai:seat-1:1');
    const reduction = reduceAuthoritativeGameAction(makeState(deadlineAt, 2, true), {
      ...baseAction,
      payload: {
        ...baseAction.payload,
        automationSource: 'timeout_ai',
        coordinatorSeatId: 'seat-2',
      },
    }, room, sides);
    assert.equal(isAuthoritativeCommitReduction(reduction), true);
    if (!isAuthoritativeCommitReduction(reduction)) return;
    assert.equal(getCounts(reduction.patch.turnActionTimeoutCountBySeatId)?.['seat-1'], 2);
    assert.equal(getAutoPlay(reduction.patch.autoPlayBySeatId)?.['seat-1'], true);
  } finally {
    Date.now = originalNow;
  }
});
