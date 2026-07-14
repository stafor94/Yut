import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
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

test('일반 턴 제한시간은 시간초과마다 15초에서 10초, 5초까지 줄고 더 내려가지 않는다', () => {
  assert.equal(getTurnActionTimeoutMsForCount(0, TURN_ACTION_TIMEOUT_MS), 15000);
  assert.equal(getTurnActionTimeoutMsForCount(1, TURN_ACTION_TIMEOUT_MS), 10000);
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

  assert.equal(result.status, 'committed');
  if (result.status !== 'committed') return;
  assert.deepEqual(result.patch.turnActionTimeoutCountBySeatId, { 'seat-1': 0 });
  assert.equal(result.patch.turnDeadlineKind, 'move');
  assert.equal(result.patch.turnDeadlineAt, 100000 + 2600 + TURN_ACTION_TIMEOUT_MS);
}));

test('시간초과 복구가 커밋되면 좌석 횟수를 올리고 바로 다음 막대를 5초 단축한다', () => withMockNow(200000, () => {
  const state = baseState(200000, 0);
  const result = reduceAuthoritativeGameAction(state as any, rollAction(state.turnDeadlineAt, true), room, sides);

  assert.equal(result.status, 'committed');
  if (result.status !== 'committed') return;
  assert.deepEqual(result.patch.turnActionTimeoutCountBySeatId, { 'seat-1': 1 });
  assert.equal(result.patch.turnDeadlineAt, 200000 + 2600 + 10000);
}));

test('두 번째 시간초과부터 서버 제한시간은 최소 5초로 고정된다', () => withMockNow(300000, () => {
  const state = baseState(300000, 1);
  const result = reduceAuthoritativeGameAction(state as any, rollAction(state.turnDeadlineAt, true), room, sides);

  assert.equal(result.status, 'committed');
  if (result.status !== 'committed') return;
  assert.deepEqual(result.patch.turnActionTimeoutCountBySeatId, { 'seat-1': 2 });
  assert.equal(result.patch.turnDeadlineAt, 300000 + 2600 + 5000);
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

  assert.equal(result.status, 'committed');
  if (result.status !== 'committed') return;
  assert.deepEqual(result.patch.turnActionTimeoutCountBySeatId, { 'seat-1': 0 });
  assert.equal(result.patch.turnDeadlineKind, 'item_prompt');
  assert.equal(result.patch.turnDeadlineAt, 400000 + TURN_ITEM_PROMPT_TIMEOUT_MS);
  assert.equal((result.patch.pendingItemPickup as { deadline?: number } | null)?.deadline, 400000 + TURN_ITEM_PROMPT_TIMEOUT_MS);
}));
