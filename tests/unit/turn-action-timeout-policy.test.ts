import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
} from '../../src/features/room/services/roomAuthoritativeReducer';
import { ONLINE_ROLL_FAST_PRESENTATION_MS } from '../../src/features/room/services/rollPresentationTiming';
import {
  TURN_ACTION_TIMEOUT_MIN_MS,
  TURN_ACTION_TIMEOUT_MS,
  TURN_ITEM_PROMPT_TIMEOUT_MS,
  TURN_NETWORK_GRACE_MS,
  getTurnActionTimeoutMsForCount,
} from '../../src/features/room/services/roomTiming';

const withMockNow = <T>(now: number, callback: () => T): T => {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
};

const getCommittedPatch = (result: ReturnType<typeof reduceAuthoritativeGameAction>) => {
  assert.equal(result.status, 'committed');
  assert.ok(isAuthoritativeCommitReduction(result));
  return result.patch;
};

const baseState = (now: number, timeoutCount = 0) => ({
  pieces: [
    { id: 'seat-1-piece-1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'seat-2-piece-1', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  initialTurnOrderIds: ['seat-1', 'seat-2'],
  roll: null,
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  branchChoice: 'outer',
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  pendingGoldenYutSelection: null,
  turnDeadlineAt: now - TURN_NETWORK_GRACE_MS,
  turnDeadlineKind: 'roll',
  turnActionTimeoutCountBySeatId: timeoutCount ? { 'seat-1': timeoutCount } : {},
});

const rollAction = (deadline: number, timedOut = false) => ({
  type: 'roll_yut' as const,
  actorId: 'seat-1',
  payload: {
    rollTimingZone: 'normal',
    clientRollResult: { name: '도' as const, steps: 1 },
    clientFallOccurred: false,
    clientFallCount: 0,
    ...(timedOut ? {
      timedOut: true,
      timeoutRecoveredBy: 'seat-2',
      timeoutDeadlineAt: deadline,
    } : {}),
  },
});

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: false };
const sides = [{ id: 'seat-1', team: '청팀' as const }, { id: 'seat-2', team: '홍팀' as const }];

test('네트워크 유예는 1초로 줄인다', () => {
  assert.equal(TURN_NETWORK_GRACE_MS, 1000);
});

test('일반 턴 제한시간은 시간초과마다 10초에서 5초까지 줄고 더 내려가지 않는다', () => {
  assert.equal(getTurnActionTimeoutMsForCount(0, TURN_ACTION_TIMEOUT_MS), 10000);
  assert.equal(getTurnActionTimeoutMsForCount(1, TURN_ACTION_TIMEOUT_MS), 5000);
  assert.equal(getTurnActionTimeoutMsForCount(2, TURN_ACTION_TIMEOUT_MS), 5000);
  assert.equal(getTurnActionTimeoutMsForCount(99, TURN_ACTION_TIMEOUT_MS), TURN_ACTION_TIMEOUT_MIN_MS);
});

test('아이템 선택 제한시간도 누적 시간초과를 반영하되 5초 아래로 줄지 않는다', () => {
  assert.equal(getTurnActionTimeoutMsForCount(0, TURN_ITEM_PROMPT_TIMEOUT_MS), 10000);
  assert.equal(getTurnActionTimeoutMsForCount(1, TURN_ITEM_PROMPT_TIMEOUT_MS), 5000);
  assert.equal(getTurnActionTimeoutMsForCount(2, TURN_ITEM_PROMPT_TIMEOUT_MS), 5000);
});

test('플레이어가 정상 버튼 액션을 수행하면 누적 횟수와 다음 제한시간을 기본값으로 복구한다', () => withMockNow(100000, () => {
  const state = baseState(100000, 2);
  const result = reduceAuthoritativeGameAction(state as any, rollAction(state.turnDeadlineAt), room, sides);
  const patch = getCommittedPatch(result);

  assert.deepEqual(patch.turnActionTimeoutCountBySeatId, { 'seat-1': 0 });
  assert.equal(patch.turnDeadlineKind, 'move');
  assert.equal(patch.turnDeadlineAt, 100000 + ONLINE_ROLL_FAST_PRESENTATION_MS + TURN_ACTION_TIMEOUT_MS);
}));

test('시간초과 복구가 커밋되면 좌석 횟수를 올리고 연출 완료 뒤 다음 막대를 5초 단축한다', () => withMockNow(200000, () => {
  const state = baseState(200000, 0);
  const result = reduceAuthoritativeGameAction(state as any, rollAction(state.turnDeadlineAt, true), room, sides);
  const patch = getCommittedPatch(result);

  assert.deepEqual(patch.turnActionTimeoutCountBySeatId, { 'seat-1': 1 });
  assert.equal(patch.turnDeadlineAt, 200000 + ONLINE_ROLL_FAST_PRESENTATION_MS + 5000);
}));

test('두 번째 시간초과부터 서버 제한시간은 연출 완료 뒤 최소 5초로 고정된다', () => withMockNow(300000, () => {
  const state = baseState(300000, 1);
  const result = reduceAuthoritativeGameAction(state as any, rollAction(state.turnDeadlineAt, true), room, sides);
  const patch = getCommittedPatch(result);

  assert.deepEqual(patch.turnActionTimeoutCountBySeatId, { 'seat-1': 2 });
  assert.deepEqual(patch.autoPlayBySeatId, { 'seat-1': true });
  assert.equal(patch.turnDeadlineAt, 300000 + ONLINE_ROLL_FAST_PRESENTATION_MS + 5000);
}));

test('AI 자동 플레이 액션은 누적 timeout 횟수와 자동 플레이 상태를 초기화하지 않는다', () => withMockNow(350000, () => {
  const state = {
    ...baseState(350000, 2),
    autoPlayBySeatId: { 'seat-1': true },
  };
  const baseAction = rollAction(state.turnDeadlineAt);
  const action = {
    ...baseAction,
    payload: {
      ...baseAction.payload,
      automationSource: 'timeout_ai',
      coordinatorSeatId: 'seat-2',
      clientActionId: 'roll_yut_ai:seat-1:1',
    },
  };
  const patch = getCommittedPatch(reduceAuthoritativeGameAction(state as any, action, room, sides));

  assert.equal((patch.turnActionTimeoutCountBySeatId as Record<string, number> | undefined), undefined);
  assert.equal((patch.autoPlayBySeatId as Record<string, boolean> | undefined), undefined);
}));

test('자동 플레이 중에는 직접 플레이 액션을 authoritative 경계에서 거부한다', () => withMockNow(360000, () => {
  const state = {
    ...baseState(360000, 2),
    autoPlayBySeatId: { 'seat-1': true },
  };
  const result = reduceAuthoritativeGameAction(state as any, rollAction(state.turnDeadlineAt), room, sides);

  assert.equal(result.status, 'rejected');
  assert.match(result.reason ?? '', /AI 자동 플레이 중/);
}));

test('직접 플레이 복귀는 자동 플레이와 timeout 횟수를 해제하고 현재 단계에 10초를 다시 부여한다', () => withMockNow(375000, () => {
  const state = {
    ...baseState(375000, 2),
    autoPlayBySeatId: { 'seat-1': true },
  };
  const patch = getCommittedPatch(reduceAuthoritativeGameAction(
    state as any,
    { type: 'resume_human_control', actorId: 'seat-1', payload: { clientActionId: 'resume-seat-1' } },
    room,
    sides,
  ));

  assert.deepEqual(patch.autoPlayBySeatId, { 'seat-1': false });
  assert.deepEqual(patch.turnActionTimeoutCountBySeatId, { 'seat-1': 0 });
  assert.equal(patch.turnDeadlineAt, 375000 + TURN_ACTION_TIMEOUT_MS);
}));

test('정상 이동 뒤 아이템 교체 선택도 기본 10초로 복구하고 내부 deadline을 일치시킨다', () => withMockNow(400000, () => {
  const state = {
    ...baseState(400000, 1),
    pieces: [
      { id: 'seat-1-piece-1', ownerId: 'seat-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false },
      { id: 'seat-2-piece-1', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    ],
    roll: { name: '도' as const, steps: 1 },
    boardItems: [{ id: 'item-1', type: 'move_minus_one' as const, nodeId: 'n03' }],
    ownedItems: { 'seat-1': ['move_plus_one' as const] },
    turnDeadlineKind: 'move' as const,
  };
  const result = reduceAuthoritativeGameAction(
    state as any,
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'seat-1-piece-1', branchChoice: 'outer' } },
    room,
    sides,
  );
  const patch = getCommittedPatch(result);

  assert.deepEqual(patch.turnActionTimeoutCountBySeatId, { 'seat-1': 0 });
  assert.equal(patch.turnDeadlineKind, 'item_prompt');
  assert.equal(patch.turnDeadlineAt, 400000 + TURN_ITEM_PROMPT_TIMEOUT_MS);
  assert.equal((patch.pendingItemPickup as { deadline?: number } | null)?.deadline, 400000 + TURN_ITEM_PROMPT_TIMEOUT_MS);
}));
