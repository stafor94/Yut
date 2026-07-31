import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: false };
const sides = [{ id: 'seat-1', team: '청팀' as const }, { id: 'seat-2', team: '홍팀' as const }];

const makeState = (deadlineAt: number, timeoutCount = 0, autoPlay = false) => ({
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
  turnActionTimeoutCountBySeatId: timeoutCount ? { 'seat-1': timeoutCount } : {},
  autoPlayBySeatId: autoPlay ? { 'seat-1': true } : {},
  gameSeats: [
    { id: 'seat-1', isAI: false, isSubstitutedByAI: false },
    { id: 'seat-2', isAI: false, isSubstitutedByAI: false },
  ],
});

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

test('실제 timeout action 두 번의 authoritative commit에서 count 1→2와 autoplay가 같은 patch로 전환된다', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 100_100;
    const firstDeadline = 100_000;
    const first = reduceAuthoritativeGameAction(makeState(firstDeadline), makeTimeoutRoll(firstDeadline, 'timeout:first'), room, sides);
    assert.equal(first.status, 'committed');
    if (first.status !== 'committed') return;
    assert.equal(first.patch.turnActionTimeoutCountBySeatId?.['seat-1'], 1);
    assert.notEqual(first.patch.autoPlayBySeatId?.['seat-1'], true);

    Date.now = () => 200_100;
    const secondDeadline = 200_000;
    const secondState = {
      ...makeState(secondDeadline, 1),
      turnActionTimeoutCountBySeatId: first.patch.turnActionTimeoutCountBySeatId,
      autoPlayBySeatId: first.patch.autoPlayBySeatId ?? {},
    };
    const second = reduceAuthoritativeGameAction(secondState, makeTimeoutRoll(secondDeadline, 'timeout:second'), room, sides);
    assert.equal(second.status, 'committed');
    if (second.status !== 'committed') return;
    assert.equal(second.patch.turnActionTimeoutCountBySeatId?.['seat-1'], 2);
    assert.equal(second.patch.autoPlayBySeatId?.['seat-1'], true);
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
  assert.match(reduction.reason ?? '', /AI 자동 플레이/);
});

test('timeout AI action은 기존 연속 timeout count를 정상 수동 행동처럼 초기화하지 않는다', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 300_100;
    const deadlineAt = 300_000;
    const reduction = reduceAuthoritativeGameAction(makeState(deadlineAt, 2, true), {
      ...makeTimeoutRoll(deadlineAt, 'roll_yut_ai:seat-1:1'),
      payload: {
        ...makeTimeoutRoll(deadlineAt, 'roll_yut_ai:seat-1:1').payload,
        automationSource: 'timeout_ai',
        coordinatorSeatId: 'seat-2',
      },
    }, room, sides);
    assert.equal(reduction.status, 'committed');
    if (reduction.status !== 'committed') return;
    assert.equal(reduction.patch.turnActionTimeoutCountBySeatId?.['seat-1'], 2);
    assert.equal(reduction.patch.autoPlayBySeatId?.['seat-1'], true);
  } finally {
    Date.now = originalNow;
  }
});
