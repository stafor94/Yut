import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext';
import { buildPreparedRoomGameState } from '../../src/app/flows/gameStartPreparation';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducerCore';

const room = { playMode: 'individual' as const, pieceCount: 2 as const, stackedRollMode: false };
const sides = [
  { id: 'p1', team: '청팀' as const },
  { id: 'p2', team: '홍팀' as const },
];

const makePiece = (id: string, ownerId: string, nodeId = 'n02') => ({
  id,
  ownerId,
  label: id,
  nodeIndex: 1,
  nodeId,
  started: true,
  finished: false,
  color: '#000',
});

const makeState = (overrides: Record<string, unknown> = {}) => ({
  pieces: [makePiece('p1-piece-1', 'p1'), makePiece('p2-piece-1', 'p2')],
  turnIndex: 0,
  turnOrderIds: ['p1', 'p2'],
  initialTurnOrderIds: ['p1', 'p2'],
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
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  turnOrderPhase: null,
  turnOrderIntro: null,
  pendingTrapPlacement: null,
  pendingItemPickup: null,
  turnDeadlineAt: 0,
  turnDeadlineKind: 'roll',
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  lastMovedPieceIds: [],
  lastMovedSeatId: '',
  branchChoice: 'outer',
  rollResultReadyAt: 0,
  fallEffect: null,
  pendingGoldenYutSelection: null,
  ...overrides,
});

const assertCommitted = (result: ReturnType<typeof reduceAuthoritativeGameAction>) => {
  assert.equal(result.status, 'committed');
  assert.ok('patch' in result);
  return result as Extract<typeof result, { status: 'committed' }>;
};

test('effective move context resolves the selected and overridden stack index', () => {
  const rollStack = [
    { name: '도' as const, steps: 1, bonus: false },
    { name: '걸' as const, steps: 3, bonus: false },
  ];
  const selected = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: rollStack[0],
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: 1,
  });
  assert.equal(selected.rollStackIndex, 1);
  assert.equal(selected.steps, 3);
  assert.equal(selected.roll, rollStack[1]);

  const overridden = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: rollStack[1],
    rollStack,
    rollStackClosed: true,
    selectedRollStackIndex: 1,
    rollStackIndexOverride: 0,
  });
  assert.equal(overridden.rollStackIndex, 0);
  assert.equal(overridden.steps, 1);
  assert.equal(overridden.roll, rollStack[0]);
});

test('new prepared game state clears every pending item and movement field', () => {
  const state = buildPreparedRoomGameState({
    roomId: 'room-1',
    room: { id: 'room-1', hostId: 'p1', maxPlayers: 2, itemMode: true, playMode: 'individual', pieceCount: 2 },
    players: [
      { id: 'p1', nickname: 'A', color: 'red', seatIndex: 0, team: '청팀', ready: true },
      { id: 'p2', nickname: 'B', color: 'blue', seatIndex: 1, team: '홍팀', ready: true },
    ],
    startRequestVersion: 2,
    startRequestId: 'start-2',
    countdownEndsAt: Date.now(),
  });
  assert.equal(state.pendingItemPickup, null);
  assert.equal(state.pendingTrapPlacement, null);
  assert.equal(state.pendingGoldenYutSelection, null);
  assert.equal(state.pendingAfterMoveTurnIndex, undefined);
  assert.equal(state.itemPromptTiming, null);
  assert.equal(state.selectedRollStackIndex, null);
  assert.deepEqual(state.lastMovedPieceIds, []);
  assert.equal(state.lastMovedSeatId, '');
});

test('expired item pickup is authoritatively kept and unblocks the turn', () => {
  const deadline = Date.now() - 30_000;
  const result = assertCommitted(reduceAuthoritativeGameAction(
    makeState({
      ownedItems: { p1: ['shield'] },
      pendingItemPickup: {
        ownerId: 'p1',
        itemId: 'item-1',
        itemType: 'trap',
        existingItemType: 'shield',
        deadline,
        nextTurnIndex: 1,
      },
      turnDeadlineKind: 'item_prompt',
      turnDeadlineAt: deadline,
    }) as never,
    {
      type: 'item_pickup_decision',
      actorId: 'p1',
      payload: {
        decision: 'keep',
        itemPickupTimeoutRecovery: true,
        timeoutDeadlineAt: deadline,
        timeoutRecoveredBy: 'p2',
      },
    } as never,
    room,
    sides,
  ));
  assert.equal(result.patch.pendingItemPickup, null);
  assert.equal(result.patch.turnIndex, 1);
  assert.equal(result.patch.turnDeadlineKind, 'roll');
  assert.deepEqual((result.patch.ownedItems as Record<string, string[]>).p1, ['shield']);
});

test('a roll expires only shields controlled by the rolling actor', () => {
  const result = assertCommitted(reduceAuthoritativeGameAction(
    makeState({ shieldedPieceIds: ['p1-piece-1', 'p2-piece-1'] }) as never,
    {
      type: 'roll_yut',
      actorId: 'p1',
      payload: { rollTimingZone: 'bad', clientFallOccurred: false, clientFallCount: 0 },
    } as never,
    room,
    sides,
  ));
  assert.deepEqual(result.patch.shieldedPieceIds, ['p2-piece-1']);
});

test('fall offers only reroll and keeps the actor turn until the choice resolves', () => {
  const result = assertCommitted(reduceAuthoritativeGameAction(
    makeState({ ownedItems: { p1: ['reroll', 'move_plus_one'] } }) as never,
    {
      type: 'roll_yut',
      actorId: 'p1',
      payload: { rollTimingZone: 'bad', clientFallOccurred: true, clientFallCount: 1 },
    } as never,
    room,
    sides,
  ));
  assert.equal(result.patch.turnIndex, 0);
  assert.equal(result.patch.itemPromptTiming, 'after_roll');
  assert.equal(result.patch.pendingAfterMoveTurnIndex, 1);
  assert.ok(result.patch.roll);
  assert.equal(result.payload.fallRerollPrompt, true);
});

test('zero-step movement still opens an after-move shield prompt', () => {
  const result = assertCommitted(reduceAuthoritativeGameAction(
    makeState({
      roll: { name: '도', steps: 0, bonus: false },
      ownedItems: { p1: ['shield'] },
      turnDeadlineKind: 'move',
    }) as never,
    { type: 'move_piece', actorId: 'p1', payload: { pieceId: 'p1-piece-1', branchChoice: 'outer', extraSteps: 0 } } as never,
    room,
    sides,
  ));
  assert.deepEqual(result.patch.lastMovedPieceIds, ['p1-piece-1']);
  assert.equal(result.patch.itemPromptTiming, 'after_move');
  assert.equal(result.patch.pendingAfterMoveTurnIndex, 1);
});

test('unusable trap does not create an after-move item prompt', () => {
  const result = assertCommitted(reduceAuthoritativeGameAction(
    makeState({
      pieces: [makePiece('p1-piece-1', 'p1', 'finish'), makePiece('p2-piece-1', 'p2')],
      roll: { name: '도', steps: 0, bonus: false },
      ownedItems: { p1: ['trap'] },
      turnDeadlineKind: 'move',
    }) as never,
    { type: 'move_piece', actorId: 'p1', payload: { pieceId: 'p1-piece-1', branchChoice: 'outer', extraSteps: 0 } } as never,
    room,
    sides,
  ));
  assert.notEqual(result.patch.itemPromptTiming, 'after_move');
  assert.equal(result.patch.turnDeadlineKind, 'roll');
});

test('stacked movement items and reroll target the exact selected stack index', () => {
  const rollStack = [
    { name: '도' as const, steps: 1, bonus: false },
    { name: '걸' as const, steps: 3, bonus: false },
  ];
  const stackedRoom = { ...room, stackedRollMode: true };
  const adjusted = assertCommitted(reduceAuthoritativeGameAction(
    makeState({
      roll: rollStack[1],
      rollStack,
      selectedRollStackIndex: 1,
      rollStackClosed: true,
      ownedItems: { p1: ['move_plus_one'] },
      itemPromptTiming: 'after_roll',
      turnDeadlineKind: 'item_prompt',
    }) as never,
    { type: 'use_item', actorId: 'p1', payload: { itemType: 'move_plus_one', rollStackIndex: 1 } } as never,
    stackedRoom,
    sides,
  ));
  const adjustedStack = adjusted.patch.rollStack as Array<{ steps: number }>;
  assert.equal(adjustedStack[0].steps, 1);
  assert.equal(adjustedStack[1].steps, 4);
  assert.equal(adjusted.patch.selectedRollStackIndex, 1);
  assert.equal((adjusted.patch.roll as { steps: number }).steps, 4);

  const rerolled = assertCommitted(reduceAuthoritativeGameAction(
    makeState({
      roll: rollStack[0],
      rollStack,
      selectedRollStackIndex: 0,
      rollStackClosed: true,
      ownedItems: { p1: ['reroll'] },
      itemPromptTiming: 'after_roll',
      turnDeadlineKind: 'item_prompt',
    }) as never,
    { type: 'use_item', actorId: 'p1', payload: { itemType: 'reroll', rollStackIndex: 0 } } as never,
    stackedRoom,
    sides,
  ));
  assert.deepEqual(rerolled.patch.rollStack, [rollStack[1]]);
  assert.equal(rerolled.patch.selectedRollStackIndex, 0);
  assert.equal(rerolled.patch.rollStackClosed, false);
});
