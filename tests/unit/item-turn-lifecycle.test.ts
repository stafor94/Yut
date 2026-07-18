import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_NETWORK_GRACE_MS } from '../../src/features/room/services/roomTiming';
import type { YutResult } from '../../src/game-core/roll';

const DO: YutResult = { name: '도', steps: 1, bonus: false };

const makeState = (overrides: Record<string, unknown> = {}) => ({
  pieces: [
    { id: 'p1', ownerId: 'seat-1', label: 'P1-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false, color: 'red' },
    { id: 'p2', ownerId: 'seat-2', label: 'P2-1', nodeIndex: 3, nodeId: 'n04', started: true, finished: false, color: 'blue' },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2'],
  initialTurnOrderIds: ['seat-1', 'seat-2'],
  completedSeatIds: [],
  rankingSeatIds: [],
  gameEndMode: '',
  lastFinishedSeatId: '',
  continuationRound: 0,
  roll: null,
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  boardItems: [],
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  turnOrderPhase: { active: false },
  turnOrderIntro: null,
  pendingTrapPlacement: null,
  pendingItemPickup: null,
  turnDeadlineAt: Date.now() + 15_000,
  turnDeadlineKind: 'roll',
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  lastMovedPieceIds: [],
  lastMovedSeatId: '',
  branchChoice: 'outer',
  rollResultReadyAt: 0,
  ownedItems: {},
  fallEffect: null,
  lastRollTimingZone: null,
  pendingGoldenYutSelection: null,
  ...overrides,
}) as any;

const individualRoom = { playMode: 'individual' as const, pieceCount: 4 as const, stackedRollMode: false };
const sides = [{ id: 'seat-1', team: '청팀' as const }, { id: 'seat-2', team: '홍팀' as const }];

test('effective move context selects the exact stacked roll index', () => {
  const context = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: DO,
    rollStack: [DO, { name: '개', steps: 2, bonus: false }],
    rollStackClosed: true,
    selectedRollStackIndex: 1,
  });

  assert.equal(context.fromStack, true);
  assert.equal(context.rollStackIndex, 1);
  assert.equal(context.roll?.name, '개');
  assert.equal(context.steps, 2);
});

test('roll start expires only shields controlled by the rolling side', () => {
  const result = reduceAuthoritativeGameAction(
    makeState({ shieldedPieceIds: ['p1', 'p2'] }),
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', clientRollResult: DO, clientFallOccurred: false, clientFallCount: 0 } },
    individualRoom,
    sides,
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.shieldedPieceIds, ['p2']);
});

test('fall keeps the actor turn and opens only the reroll prompt when reroll is owned', () => {
  const result = reduceAuthoritativeGameAction(
    makeState({ ownedItems: { 'seat-1': ['reroll'] } }),
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', clientRollResult: DO, clientFallOccurred: true, clientFallCount: 1, actorLogName: '사용자1' } },
    individualRoom,
    sides,
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.turnIndex, 0);
  assert.equal(result.patch?.itemPromptTiming, 'after_roll');
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, 1);
  assert.equal((result.patch?.roll as YutResult | null)?.name, '도');
  assert.equal(result.payload?.fallRerollPrompt, true);
  assert.match(String((result.patch?.logs as Array<{ text?: string }>)[0]?.text), /다시 던지기 아이템 사용 여부/);
});

test('skipping the fall reroll prompt advances to the stored next turn', () => {
  const fall = reduceAuthoritativeGameAction(
    makeState({ ownedItems: { 'seat-1': ['reroll'] } }),
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'normal', clientRollResult: DO, clientFallOccurred: true, clientFallCount: 1 } },
    individualRoom,
    sides,
  );
  assert.equal(fall.status, 'committed');

  const skipped = reduceAuthoritativeGameAction(
    { ...makeState({ ownedItems: { 'seat-1': ['reroll'] } }), ...fall.patch } as any,
    { type: 'use_item', actorId: 'seat-1', payload: { skipAfterRollItem: true } },
    individualRoom,
    sides,
  );

  assert.equal(skipped.status, 'committed');
  assert.equal(skipped.patch?.turnIndex, 1);
  assert.equal(skipped.patch?.roll, null);
  assert.equal(skipped.patch?.pendingAfterMoveTurnIndex, null);
  assert.equal(skipped.patch?.itemPromptTiming, null);
});

test('expired item replacement is authoritatively resolved as keep', () => {
  const deadline = Date.now() - TURN_NETWORK_GRACE_MS - 100;
  const result = reduceAuthoritativeGameAction(
    makeState({
      ownedItems: { 'seat-1': ['move_plus_one'] },
      pendingItemPickup: {
        ownerId: 'seat-1',
        itemId: 'item-1',
        itemType: 'move_minus_one',
        existingItemType: 'move_plus_one',
        deadline,
        nextTurnIndex: 1,
      },
      turnDeadlineAt: deadline,
      turnDeadlineKind: 'item_prompt',
    }),
    { type: 'item_pickup_decision', actorId: 'seat-1', payload: { decision: 'keep', itemPickupTimeoutRecovery: true, timeoutDeadlineAt: deadline, timeoutRecoveredBy: 'seat-2' } },
    individualRoom,
    sides,
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['move_plus_one']);
  assert.equal(result.patch?.pendingItemPickup, null);
  assert.equal(result.patch?.turnIndex, 1);
  assert.equal(result.payload?.itemPickupTimeoutRecovery, true);
});

test('zero-step move on an on-board piece still opens the shield prompt', () => {
  const result = reduceAuthoritativeGameAction(
    makeState({ roll: { ...DO, steps: 0 }, ownedItems: { 'seat-1': ['shield'] }, turnDeadlineKind: 'move' }),
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer' } },
    individualRoom,
    sides,
  );

  assert.equal(result.status, 'committed');
  assert.deepEqual(result.patch?.lastMovedPieceIds, ['p1']);
  assert.equal(result.patch?.itemPromptTiming, 'after_move');
  assert.equal(result.patch?.pendingAfterMoveTurnIndex, 1);
});

test('unusable trap is skipped instead of opening an empty after-move prompt', () => {
  const result = reduceAuthoritativeGameAction(
    makeState({
      pieces: [
        { id: 'p1', ownerId: 'seat-1', label: 'P1-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false, color: 'red' },
        { id: 'p2', ownerId: 'seat-2', label: 'P2-1', nodeIndex: 2, nodeId: 'n03', started: true, finished: false, color: 'blue' },
      ],
      roll: { ...DO, steps: 0 },
      ownedItems: { 'seat-1': ['trap'] },
      turnDeadlineKind: 'move',
    }),
    { type: 'move_piece', actorId: 'seat-1', payload: { pieceId: 'p1', branchChoice: 'outer' } },
    individualRoom,
    sides,
  );

  assert.equal(result.status, 'committed');
  assert.notEqual(result.patch?.itemPromptTiming, 'after_move');
  assert.equal(result.patch?.turnIndex, 1);
});

test('stacked move adjustment changes only the explicitly selected stack', () => {
  const stackedRoom = { ...individualRoom, stackedRollMode: true };
  const result = reduceAuthoritativeGameAction(
    makeState({
      roll: DO,
      rollStack: [DO, DO],
      selectedRollStackIndex: 1,
      rollStackClosed: true,
      itemPromptTiming: 'after_roll',
      turnDeadlineKind: 'item_prompt',
      ownedItems: { 'seat-1': ['move_plus_one'] },
    }),
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'move_plus_one', rollStackIndex: 1 } },
    stackedRoom,
    sides,
  );

  assert.equal(result.status, 'committed');
  const nextStack = result.patch?.rollStack as YutResult[];
  assert.equal(nextStack[0].steps, 1);
  assert.equal(nextStack[1].steps, 2);
});
