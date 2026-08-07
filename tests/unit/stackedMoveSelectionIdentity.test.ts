import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext';
import {
  LocalMoveLedger,
  makeLocalMoveResultFingerprint,
  prepareLocalMoveOwnership,
} from '../../src/app/flows/localMoveOwnership';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import {
  STACKED_MOVE_SELECTION_STALE_REASON,
  attachLatestStackedMoveSelectionIdentity,
  clearStackedMoveSelectionIdentityContext,
  publishAuthoritativeStackedMoveContext,
} from '../../src/features/room/services/stackedMoveSelectionIdentity';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const MO = { name: '모', steps: 5, bonus: true } as const;
const BACKDO = { name: '빽도', steps: -1, bonus: false } as const;
const SIDES = [
  { id: 'P1', team: '청팀' as const },
  { id: 'P2', team: '홍팀' as const },
];
const ROOM = {
  playMode: 'individual' as const,
  pieceCount: 1 as const,
  stackedRollMode: true,
};

const makeState = (overrides: Record<string, unknown> = {}) => ({
  playMode: 'individual' as const,
  pieceCount: 1 as const,
  stackedRollMode: true,
  gameSeats: SIDES,
  turnOrderIds: ['P1', 'P2'],
  turnIndex: 0,
  pieces: [
    { id: 'piece-1', ownerId: 'P1', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
    { id: 'piece-2', ownerId: 'P2', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
  ],
  roll: null,
  rollStack: [MO, BACKDO],
  selectedRollStackIndex: null,
  rollStackClosed: true,
  branchChoice: 'outer',
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  lastMovedPieceIds: [],
  lastMovedSeatId: '',
  pendingItemPickup: null,
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  pendingGoldenYutSelection: null,
  pendingTrapPlacement: null,
  completedSeatIds: [],
  rankingSeatIds: [],
  gameEndMode: '',
  lastFinishedSeatId: '',
  winner: '',
  autoPlayBySeatId: {},
  turnActionTimeoutCountBySeatId: {},
  turnDeadlineKind: 'move',
  turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
  lastSequence: 10,
  turnVersion: 3,
  ...overrides,
});

const makeAction = (sequence: number, rollStackIndex: number) => ({
  type: 'move_piece' as const,
  actorId: 'P1',
  payload: {
    pieceId: 'piece-1',
    extraSteps: 0,
    branchChoice: 'outer',
    rollStackIndex,
    clientActionId: `move_piece:P1:${sequence}:0:ready:0:::piece-1:0:outer:stack:${rollStackIndex}`,
    clientActionStartedAt: Date.now(),
  } as Record<string, unknown>,
});

const selectStackIndex = (state: ReturnType<typeof makeState>, index: number) => {
  publishAuthoritativeStackedMoveContext(state);
  return resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: null,
    rollStack: state.rollStack as typeof MO[],
    rollStackClosed: true,
    selectedRollStackIndex: index,
  });
};

test.afterEach(() => {
  clearStackedMoveSelectionIdentityContext();
});

test('[모, 빽도]에서 모 선택 identity는 authoritative revision과 roll fingerprint를 action에 고정한다', () => {
  const state = makeState();
  const selected = selectStackIndex(state, 0);
  assert.deepEqual(selected.roll, MO);

  const action = makeAction(10, 0);
  assert.equal(attachLatestStackedMoveSelectionIdentity(action), true);
  assert.deepEqual(action.payload.stackedMoveSelection, {
    expectedPreviousSequence: 10,
    expectedTurnVersion: 3,
    expectedTurnIndex: 0,
    rollStackIndex: 0,
    roll: MO,
  });
});

test('[모, 빽도]는 모 +5를 한 번 소비한 뒤 빽도 -1을 같은 actor가 소비하고 그때만 턴을 넘긴다', () => {
  const firstState = makeState();
  assert.deepEqual(selectStackIndex(firstState, 0).roll, MO);
  const firstAction = makeAction(10, 0);
  const first = reduceAuthoritativeGameAction(firstState, firstAction, ROOM, SIDES);
  assert.equal(first.status, 'committed');
  if (first.status !== 'committed') return;
  const firstPiece = first.patch.pieces?.find((piece) => piece.id === 'piece-1');
  assert.equal(firstPiece?.nodeId, 'n06');
  assert.deepEqual(first.patch.rollStack, [BACKDO]);
  assert.equal(first.patch.turnIndex, 0);

  const secondState = makeState({
    ...first.patch,
    lastSequence: 11,
    turnVersion: 4,
    turnIndex: 0,
    rollStack: [BACKDO],
    selectedRollStackIndex: null,
    rollStackClosed: true,
    turnDeadlineKind: 'move',
    turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
  });
  assert.deepEqual(selectStackIndex(secondState, 0).roll, BACKDO);
  const secondAction = makeAction(11, 0);
  const second = reduceAuthoritativeGameAction(secondState, secondAction, ROOM, SIDES);
  assert.equal(second.status, 'committed');
  if (second.status !== 'committed') return;
  const secondPiece = second.patch.pieces?.find((piece) => piece.id === 'piece-1');
  assert.equal(secondPiece?.nodeId, 'n05');
  assert.deepEqual(second.patch.rollStack, []);
  assert.equal(second.patch.turnIndex, 1);
});

test('표시 stack이 최신 authoritative stack과 다르면 presentation용 effective roll을 만들지 않는다', () => {
  const authoritativeState = makeState({
    lastSequence: 11,
    turnVersion: 4,
    rollStack: [BACKDO],
  });
  publishAuthoritativeStackedMoveContext(authoritativeState);

  const staleSelection = resolveEffectiveMoveContext({
    stackedRollMode: true,
    roll: null,
    rollStack: [MO, BACKDO],
    rollStackClosed: true,
    selectedRollStackIndex: 0,
  });
  assert.equal(staleSelection.roll, null);
  assert.equal(staleSelection.steps, 0);
  assert.equal(staleSelection.rollStackIndex, 0);
});

test('선택 뒤 authoritative revision이 바뀌면 같은 stack index를 새 roll로 재해석하지 않고 mutation 전에 거부한다', () => {
  const displayedState = makeState();
  assert.deepEqual(selectStackIndex(displayedState, 0).roll, MO);
  const staleAction = makeAction(10, 0);
  assert.equal(attachLatestStackedMoveSelectionIdentity(staleAction), true);

  const currentState = makeState({
    lastSequence: 11,
    turnVersion: 4,
    rollStack: [BACKDO],
  });
  publishAuthoritativeStackedMoveContext(currentState);
  const result = reduceAuthoritativeGameAction(currentState, staleAction, ROOM, SIDES);
  assert.deepEqual(result, { status: 'rejected', reason: STACKED_MOVE_SELECTION_STALE_REASON });
});

test('local move ownership은 동일 selection identity의 공유 reducer 결과를 소유하고 ACK fingerprint가 일치한다', () => {
  const state = makeState();
  assert.deepEqual(selectStackIndex(state, 0).roll, MO);
  const action = makeAction(10, 0);
  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state,
    action,
  });
  assert.ok(prepared);
  assert.deepEqual(action.payload.stackedMoveSelection, {
    expectedPreviousSequence: 10,
    expectedTurnVersion: 3,
    expectedTurnIndex: 0,
    rollStackIndex: 0,
    roll: MO,
  });
  const ledger = new LocalMoveLedger();
  const record = ledger.register(prepared.record);
  const observed = ledger.observeAuthoritativeResult({
    clientMutationId: record.clientMutationId,
    sequence: 11,
    stateVersion: 4,
    resultFingerprint: makeLocalMoveResultFingerprint(prepared.finalState),
  });
  assert.equal(observed.status, 'matched');
  assert.equal(record.hardResyncStarted, false);
  assert.equal(ledger.size(), 1);
  assert.equal(ledger.markPresentationCompleted(record.clientMutationId), true);
  assert.equal(ledger.size(), 0);
});
