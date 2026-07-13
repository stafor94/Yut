import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import type { EngineState } from '../../src/game-core/gameEngine';

const makeItemPickupState = (existingItem: 'reroll' | 'move_minus_one'): EngineState => ({
  pieces: [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: { name: '도', steps: 1, bonus: false },
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: { 'seat-1': [existingItem] },
});

const moveAiOntoItem = (state: EngineState, itemType: 'reroll' | 'move_minus_one') => {
  state.boardItems = [{ id: 'item-1', type: itemType, nodeId: 'n03' }];
  return reduceAuthoritativeGameAction(
    state,
    {
      type: 'move_piece',
      actorId: 'seat-1',
      payload: {
        pieceId: 'p1',
        branchChoice: 'outer',
        coordinatorSeatId: 'seat-2',
        actorLogName: 'P1-AI',
      },
    },
    { playMode: 'individual', pieceCount: 4 },
  );
};

test('온라인 AI는 더 가치가 높은 같은 시점 아이템을 즉시 교체하고 다음 턴을 재개한다', () => {
  const result = moveAiOntoItem(makeItemPickupState('move_minus_one'), 'reroll');

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['reroll']);
  assert.equal(result.patch?.pendingItemPickup, null);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
  assert.equal(result.payload?.autoResolvedItemPickup, true);
  assert.equal(result.payload?.itemPickupDecision, 'replace');
});

test('온라인 AI는 더 가치가 낮은 신규 아이템 대신 기존 아이템을 유지하고 다음 턴을 재개한다', () => {
  const result = moveAiOntoItem(makeItemPickupState('reroll'), 'move_minus_one');

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['reroll']);
  assert.equal(result.patch?.pendingItemPickup, null);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
  assert.equal(result.payload?.autoResolvedItemPickup, true);
  assert.equal(result.payload?.itemPickupDecision, 'keep');
});

test('사람 플레이어의 같은 시점 아이템 발견은 기존 교체 선택 대기를 유지한다', () => {
  const state = makeItemPickupState('move_minus_one');
  state.boardItems = [{ id: 'item-1', type: 'reroll', nodeId: 'n03' }];

  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer', actorLogName: 'P1' } },
    { playMode: 'individual', pieceCount: 4 },
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['move_minus_one']);
  assert.equal((result.patch?.pendingItemPickup as { itemType?: string })?.itemType, 'reroll');
  assert.equal(result.patch?.turnDeadlineKind, 'item_prompt');
  assert.equal(result.payload?.autoResolvedItemPickup, undefined);
});
