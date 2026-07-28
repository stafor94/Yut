import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_NETWORK_GRACE_MS } from '../../src/features/room/services/roomTiming';

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: true };
const sides = [
  { id: 'seat-1', team: '청팀' as const },
  { id: 'seat-2', team: '홍팀' as const },
];

type StackedTimeoutPatch = {
  pieces?: Array<{ id: string; started: boolean }>;
  roll?: unknown | null;
  rollStack?: Array<{ name: string; steps: number }>;
  rollStackClosed?: boolean;
  selectedRollStackIndex?: number | null;
  turnActionTimeoutCountBySeatId?: Record<string, number>;
  turnDeadlineKind?: string;
  turnIndex?: number;
};

const withMockNow = <T>(now: number, callback: () => T): T => {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
};

const makeState = (deadlineAt: number) => ({
  pieces: [{ id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false }],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: null,
  rollStack: [
    { name: '도', steps: 1 },
    { name: '걸', steps: 3 },
  ],
  selectedRollStackIndex: null,
  rollStackClosed: true,
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
  turnDeadlineAt: deadlineAt,
  turnDeadlineKind: 'move',
  turnActionTimeoutCountBySeatId: {},
});

const makeRecoveryAction = (deadlineAt: number, overrides: Record<string, unknown> = {}) => ({
  type: 'move_piece',
  actorId: 'seat-1',
  payload: {
    pieceId: 'p1',
    branchChoice: 'outer',
    rollStackIndex: 0,
    recoveredByCoordinator: true,
    timeoutDeadlineAt: deadlineAt,
    coordinatorSeatId: 'seat-1',
    coordinatorEpoch: 1,
    clientActionId: `timeout:room:move:seat-1:${deadlineAt}`,
    ...overrides,
  },
});

test('deadline+grace 이후 coordinator가 0번 스택 하나만 소비하고 나머지를 보존한다', () => {
  const deadlineAt = 10_000;
  const state = makeState(deadlineAt);
  const result = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS, () => reduceAuthoritativeGameAction(
    state as never,
    makeRecoveryAction(deadlineAt) as never,
    room,
    sides,
  ));

  assert.equal(result.status, 'committed');
  if (result.status !== 'committed' || !result.patch) return;
  const patch = result.patch as StackedTimeoutPatch;
  assert.deepEqual(patch.rollStack, [{ name: '걸', steps: 3 }]);
  assert.equal(patch.selectedRollStackIndex, 0);
  assert.equal(patch.rollStackClosed, true);
  assert.equal(patch.turnIndex, 0);
  assert.equal(patch.turnDeadlineKind, 'roll');
  assert.equal(patch.roll, null);
  assert.equal(patch.turnActionTimeoutCountBySeatId?.['seat-1'], 1);
  const movedPiece = patch.pieces?.find((piece) => piece.id === 'p1');
  assert.equal(movedPiece?.started, true);
});

test('잘못된 timeout deadline 또는 rollStackIndex는 stacked recovery를 거부한다', () => {
  const deadlineAt = 10_000;
  const state = makeState(deadlineAt);
  const staleDeadline = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS, () => reduceAuthoritativeGameAction(
    state as never,
    makeRecoveryAction(deadlineAt, { timeoutDeadlineAt: deadlineAt - 1 }) as never,
    room,
    sides,
  ));
  assert.equal(staleDeadline.status, 'rejected');

  const invalidIndex = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS, () => reduceAuthoritativeGameAction(
    state as never,
    makeRecoveryAction(deadlineAt, { rollStackIndex: 4 }) as never,
    room,
    sides,
  ));
  assert.equal(invalidIndex.status, 'rejected');
});

test('같은 timeout action을 진행된 상태에 다시 적용해도 두 번째 이동을 만들지 않는다', () => {
  const deadlineAt = 10_000;
  const state = makeState(deadlineAt);
  const action = makeRecoveryAction(deadlineAt);
  const first = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS, () => reduceAuthoritativeGameAction(
    state as never,
    action as never,
    room,
    sides,
  ));
  assert.equal(first.status, 'committed');
  if (first.status !== 'committed' || !first.patch) return;

  const advancedState = { ...state, ...first.patch };
  const second = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS + 1, () => reduceAuthoritativeGameAction(
    advancedState as never,
    action as never,
    room,
    sides,
  ));
  assert.equal(second.status, 'rejected');
  assert.deepEqual((advancedState as typeof state).rollStack, [{ name: '걸', steps: 3 }]);
});

test('빽도에 이동 가능한 말이 없으면 빈 pieceId로 해당 스택 하나만 소비한다', () => {
  const deadlineAt = 10_000;
  const state = {
    ...makeState(deadlineAt),
    rollStack: [
      { name: '빽도', steps: -1 },
      { name: '걸', steps: 3 },
    ],
  };
  const result = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS, () => reduceAuthoritativeGameAction(
    state as never,
    makeRecoveryAction(deadlineAt, { pieceId: '' }) as never,
    room,
    sides,
  ));
  assert.equal(result.status, 'committed');
  if (result.status !== 'committed' || !result.patch) return;
  const patch = result.patch as StackedTimeoutPatch;
  assert.deepEqual(patch.rollStack, [{ name: '걸', steps: 3 }]);
  assert.equal(patch.turnIndex, 0);
});
