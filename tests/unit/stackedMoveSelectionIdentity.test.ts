import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext';
import { LocalMoveLedger, makeLocalMoveResultFingerprint, prepareLocalMoveOwnership } from '../../src/app/flows/localMoveOwnership';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';
import {
  STACKED_MOVE_SELECTION_STALE_REASON,
  attachLatestStackedMoveSelectionIdentity,
  clearStackedMoveSelectionIdentityContext,
  publishAuthoritativeStackedMoveContext,
} from '../../src/features/room/services/stackedMoveSelectionIdentity';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const MO = { name: '모', steps: 5, bonus: true };
const BACKDO = { name: '빽도', steps: -1, bonus: false };
const SIDES = [{ id: 'P1', team: '청팀' as const }, { id: 'P2', team: '홍팀' as const }];
const ROOM = { playMode: 'individual' as const, pieceCount: 1 as const, stackedRollMode: true };
const makeState = (overrides: Record<string, unknown> = {}) => ({
  playMode: 'individual' as const, pieceCount: 1 as const, stackedRollMode: true, gameSeats: SIDES,
  turnOrderIds: ['P1', 'P2'], turnIndex: 0,
  pieces: [
    { id: 'piece-1', ownerId: 'P1', nodeId: 'n01', nodeIndex: 0, started: false, finished: false },
    { id: 'piece-2', ownerId: 'P2', nodeId: 'n01', nodeIndex: 0, started: false, finished: false },
  ],
  roll: null, rollStack: [MO, BACKDO], selectedRollStackIndex: null, rollStackClosed: true,
  logs: [], winner: '', branchChoice: 'outer', boardItems: [], ownedItems: {}, trapNodes: [], shieldedPieceIds: [],
  lastMovedPieceIds: [], lastMovedSeatId: '', itemPromptTiming: null, pendingItemPickup: null,
  pendingGoldenYutSelection: null, pendingTrapPlacement: null, turnDeadlineKind: 'move',
  turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS, lastSequence: 10, turnVersion: 3, ...overrides,
});
const makeAction = (sequence: number) => ({
  type: 'move_piece' as const, actorId: 'P1', payload: {
    pieceId: 'piece-1', extraSteps: 0, branchChoice: 'outer', rollStackIndex: 0,
    clientActionId: `move_piece:P1:${sequence}:0:ready:0:::piece-1:0:outer:stack:0`, clientActionStartedAt: Date.now(),
  } as Record<string, unknown>,
});
const select = (state: ReturnType<typeof makeState>, rollStack = state.rollStack) => {
  publishAuthoritativeStackedMoveContext(state);
  return resolveEffectiveMoveContext({
    stackedRollMode: true, roll: null, rollStack: rollStack as typeof MO[], rollStackClosed: true, selectedRollStackIndex: 0,
  });
};
const findPiece = (patch: Record<string, unknown>) => (patch.pieces as Array<{ id: string; nodeId: string }> | undefined)?.find((piece) => piece.id === 'piece-1');

test.afterEach(clearStackedMoveSelectionIdentityContext);

test('선택 identity는 authoritative revision과 roll fingerprint를 action에 고정한다', () => {
  const state = makeState();
  assert.deepEqual(select(state).roll, MO);
  const action = makeAction(10);
  assert.equal(attachLatestStackedMoveSelectionIdentity(action), true);
  assert.deepEqual(action.payload.stackedMoveSelection, {
    expectedPreviousSequence: 10, expectedTurnVersion: 3, expectedTurnIndex: 0, rollStackIndex: 0, roll: MO,
  });
});

test('[모, 빽도]는 모 +5 뒤 빽도 -1을 소비하고 마지막에만 턴을 넘긴다', () => {
  const firstState = makeState();
  select(firstState);
  const first = reduceAuthoritativeGameAction(firstState, makeAction(10), ROOM, SIDES);
  assert.equal(first.status, 'committed');
  if (first.status !== 'committed') return;
  assert.equal(findPiece(first.patch)?.nodeId, 'n06');
  assert.deepEqual(first.patch.rollStack, [BACKDO]);
  assert.equal(first.patch.turnIndex, 0);

  const secondState = makeState({ ...first.patch, lastSequence: 11, turnVersion: 4, rollStack: [BACKDO], turnIndex: 0, turnDeadlineKind: 'move' });
  select(secondState);
  const second = reduceAuthoritativeGameAction(secondState, makeAction(11), ROOM, SIDES);
  assert.equal(second.status, 'committed');
  if (second.status !== 'committed') return;
  assert.equal(findPiece(second.patch)?.nodeId, 'n05');
  assert.deepEqual(second.patch.rollStack, []);
  assert.equal(second.patch.turnIndex, 1);
});

test('표시 stack이 최신 authoritative stack과 다르면 presentation 전에 차단한다', () => {
  const authoritative = makeState({ lastSequence: 11, turnVersion: 4, rollStack: [BACKDO] });
  publishAuthoritativeStackedMoveContext(authoritative);
  const stale = resolveEffectiveMoveContext({ stackedRollMode: true, roll: null, rollStack: [MO, BACKDO], rollStackClosed: true, selectedRollStackIndex: 0 });
  assert.equal(stale.roll, null);
  assert.equal(stale.steps, 0);
});

test('revision 변경 뒤 같은 index의 다른 roll은 mutation 전에 거부한다', () => {
  const displayed = makeState();
  select(displayed);
  const action = makeAction(10);
  assert.equal(attachLatestStackedMoveSelectionIdentity(action), true);
  const current = makeState({ lastSequence: 11, turnVersion: 4, rollStack: [BACKDO] });
  publishAuthoritativeStackedMoveContext(current);
  assert.deepEqual(reduceAuthoritativeGameAction(current, action, ROOM, SIDES), {
    status: 'rejected', reason: STACKED_MOVE_SELECTION_STALE_REASON,
  });
});

test('local ownership ACK는 같은 selection identity fingerprint와 일치하고 hard resync하지 않는다', () => {
  const state = makeState();
  select(state);
  const prepared = prepareLocalMoveOwnership({ roomId: 'room-a', state, action: makeAction(10) });
  assert.ok(prepared);
  const ledger = new LocalMoveLedger();
  const record = ledger.register(prepared.record);
  const observed = ledger.observeAuthoritativeResult({
    clientMutationId: record.clientMutationId, sequence: 11, stateVersion: 4,
    resultFingerprint: makeLocalMoveResultFingerprint(prepared.finalState),
  });
  assert.equal(observed.status, 'matched');
  assert.equal(record.hardResyncStarted, false);
  assert.equal(ledger.markPresentationCompleted(record.clientMutationId), true);
});
