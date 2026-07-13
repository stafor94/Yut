import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const room = { playMode: 'individual', pieceCount: 4, stackedRollMode: true } as const;

const makeState = (itemTypes: string[], rollStack = [
  { name: '윷', steps: 4, bonus: true },
  { name: '도', steps: 1 },
]) => ({
  pieces: [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  roll: rollStack[rollStack.length - 1],
  rollStack,
  selectedRollStackIndex: rollStack.length - 1,
  rollStackClosed: true,
  itemPromptTiming: 'after_roll',
  ownedItems: { 'seat-1': itemTypes },
  logs: [],
  winner: '',
  trapNodes: [],
  shieldedPieceIds: [],
  branchChoice: 'outer',
  boardItems: [],
}) as Parameters<typeof reduceAuthoritativeGameAction>[0];

test('다중 이동 스택에서 after_roll 아이템을 사용하지 않으면 스택 선택으로 돌아간다', () => {
  const state = makeState(['move_plus_one']);
  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterRollItem: true, rollStackIndex: 1 } },
    room,
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.itemPromptTiming, null);
  assert.equal(result.patch?.roll, null);
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.rollStackClosed, true);
  assert.deepEqual(result.patch?.rollStack ?? state.rollStack, state.rollStack);
});

for (const [itemType, expectedSteps] of [['move_plus_one', 2], ['move_minus_one', 0]] as const) {
  test(`다중 이동 스택에서 ${itemType} 사용 후 대상만 변경하고 스택 선택으로 돌아간다`, () => {
    const state = makeState([itemType]);
    const result = reduceAuthoritativeGameAction(
      state,
      { type: 'use_item', actorId: 'seat-1', payload: { itemType, rollStackIndex: 1 } },
      room,
    );

    assert.equal(result.status, 'committed');
    const nextStack = result.patch?.rollStack as Array<{ name: string; steps: number }>;
    assert.equal(nextStack[0]?.steps, 4);
    assert.equal(nextStack[1]?.steps, expectedSteps);
    assert.equal(result.patch?.roll, null);
    assert.equal(result.patch?.selectedRollStackIndex, null);
    assert.equal(result.patch?.rollStackClosed, true);
    assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], []);
  });
}

test('이동 스택이 하나뿐이면 한 칸 더 사용 후 유일한 스택 선택을 유지한다', () => {
  const state = makeState(['move_plus_one'], [{ name: '도', steps: 1 }]);
  const result = reduceAuthoritativeGameAction(
    state,
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'move_plus_one', rollStackIndex: 0 } },
    room,
  );

  assert.equal(result.status, 'committed');
  assert.equal((result.patch?.roll as { steps: number }).steps, 2);
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.equal(result.patch?.rollStackClosed, true);
});
