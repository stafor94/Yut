import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_NETWORK_GRACE_MS } from '../../src/features/room/services/roomTiming';

const room = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: false };
const sides = [{ id: 'seat-1', team: '청팀' as const }];

const withMockNow = <T>(now: number, callback: () => T): T => {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
};

const makeState = (deadlineAt: number, deadlineKind: 'roll' | 'move' | 'item_prompt' | 'trap_placement') => ({
  pieces: [{ id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false }],
  turnIndex: 0,
  turnOrderIds: ['seat-1'],
  roll: deadlineKind === 'move' ? { name: '도', steps: 1 } : null,
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
  turnDeadlineAt: deadlineAt,
  turnDeadlineKind: deadlineKind,
});

test('시작 시각이 없는 일반 말 이동도 network grace 이후에는 거부한다', () => {
  const deadlineAt = 10_000;
  const result = withMockNow(deadlineAt + TURN_NETWORK_GRACE_MS, () => reduceAuthoritativeGameAction(
    makeState(deadlineAt, 'move') as never,
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', clientActionId: 'move-piece-without-time' } } as never,
    room,
    sides,
  ));
  assert.deepEqual(result, { status: 'rejected', reason: '말 이동 제한 시간이 만료되었습니다.' });
});

test('deadline 이후 시작된 아이템 선택은 grace 중에도 즉시 거부한다', () => {
  const deadlineAt = 10_000;
  const state = { ...makeState(deadlineAt, 'item_prompt'), itemPromptTiming: 'before_roll' };
  const result = withMockNow(deadlineAt + 100, () => reduceAuthoritativeGameAction(
    state as never,
    { type: 'use_item', actorId: 'seat-1', payload: { skipBeforeRollItem: true, clientActionStartedAt: deadlineAt + 1, clientActionId: 'skip-after-deadline' } } as never,
    room,
    sides,
  ));
  assert.deepEqual(result, { status: 'rejected', reason: '아이템 선택 제한 시간이 만료되었습니다.' });
});

test('deadline 이후 시작된 함정 위치 선택을 거부한다', () => {
  const deadlineAt = 10_000;
  const state = {
    ...makeState(deadlineAt, 'trap_placement'),
    pendingTrapPlacement: { ownerId: 'seat-1', pieceId: 'p1', nodeIds: ['n02'], deadline: deadlineAt },
  };
  const result = withMockNow(deadlineAt + 100, () => reduceAuthoritativeGameAction(
    state as never,
    { type: 'place_trap', actorId: 'seat-1', payload: { nodeId: 'n02', pieceId: 'p1', clientActionStartedAt: deadlineAt + 1, clientActionId: 'trap-after-deadline' } } as never,
    room,
    sides,
  ));
  assert.deepEqual(result, { status: 'rejected', reason: '함정 설치 제한 시간이 만료되었습니다.' });
});

test('deadline 이후 시작된 아이템 교체 선택을 거부한다', () => {
  const deadlineAt = 10_000;
  const state = {
    ...makeState(deadlineAt, 'item_prompt'),
    pendingItemPickup: { ownerId: 'seat-1', itemId: 'item-1', itemType: 'shield', existingItemType: 'trap', deadline: deadlineAt },
  };
  const result = withMockNow(deadlineAt + 100, () => reduceAuthoritativeGameAction(
    state as never,
    { type: 'item_pickup_decision', actorId: 'seat-1', payload: { decision: 'replace', clientActionStartedAt: deadlineAt + 1, clientActionId: 'pickup-after-deadline' } } as never,
    room,
    sides,
  ));
  assert.deepEqual(result, { status: 'rejected', reason: '아이템 교체 제한 시간이 만료되었습니다.' });
});
