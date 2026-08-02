import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthoritativeSnapshot } from '../../src/app/flows/authoritativeSnapshot';
import { prepareLocalMoveOwnership, withLocalMovePiecesFallback } from '../../src/app/flows/localMoveOwnership';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const BLUE_TEAM = '\uCCAD\uD300' as const;
const RED_TEAM = '\uD64D\uD300' as const;
const MO = '\uBAA8';
const GEOL = '\uAC78';

const makeOnlineMoveState = () => ({
  playMode: 'individual' as const,
  pieceCount: 1 as const,
  stackedRollMode: false,
  gameSeats: [
    { id: 'P1', team: BLUE_TEAM },
    { id: 'P2', team: RED_TEAM },
  ],
  turnOrderIds: ['P1', 'P2'],
  turnIndex: 0,
  pieces: [
    { id: 'piece-1', ownerId: 'P1', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
    { id: 'piece-2', ownerId: 'P2', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
  ],
  roll: { name: MO, steps: 5, bonus: true },
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
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
});

test('preserves hidden local pieces after a partial authoritative result', () => {
  const firstMove = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: makeOnlineMoveState(),
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:10:0:${MO}:5:first`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(firstMove);
  assert.equal(firstMove.record.toNodeId, 'n06');
  assert.equal(Object.prototype.propertyIsEnumerable.call(firstMove.finalState, 'pieces'), false);

  const partialAppliedState = getAuthoritativeSnapshot({
    roll: { name: GEOL, steps: 3, bonus: false },
    branchChoice: 'shortcut',
    lastSequence: 12,
    turnVersion: 4,
  }, firstMove.finalState);
  assert.ok(partialAppliedState);
  assert.equal(Object.prototype.hasOwnProperty.call(partialAppliedState, 'pieces'), false);

  const secondMove = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: partialAppliedState,
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'shortcut',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:12:0:${GEOL}:3:second`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(secondMove);
  assert.equal(secondMove.record.fromNodeId, 'n06');
  assert.ok(secondMove.record.pathNodeIds.length > 0);
  assert.equal(Object.prototype.propertyIsEnumerable.call(secondMove.finalState, 'pieces'), false);
});

test('uses pieces from a complete authoritative snapshot', () => {
  const fallback = makeOnlineMoveState();
  const snapshot = {
    ...fallback,
    pieces: fallback.pieces.map((piece) => piece.id === 'piece-1'
      ? { ...piece, nodeId: 'n06', started: true }
      : piece),
    lastSequence: 11,
  };

  assert.equal(getAuthoritativeSnapshot(snapshot, fallback), snapshot);
});


test('uses rendered pieces when the controller snapshot has no pieces', () => {
  const completeState = makeOnlineMoveState();
  const { pieces, ...partialState } = completeState;
  const restoredState = withLocalMovePiecesFallback(partialState, pieces);

  assert.ok(restoredState);
  assert.equal(restoredState.pieces, pieces);
  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: restoredState,
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:10:0:${MO}:5:fallback`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(prepared);
  assert.equal(prepared.record.toNodeId, 'n06');
});


test('restores enumerable rendered pieces when hidden pieces have a symbol backup', () => {
  const firstMove = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: {
      ...makeOnlineMoveState(),
      stackedRollMode: true,
      roll: { name: MO, steps: 5, bonus: true },
    },
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:10:0:${MO}:5:hidden`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(firstMove);
  assert.equal(Object.prototype.propertyIsEnumerable.call(firstMove.finalState, 'pieces'), false);
  const restored = withLocalMovePiecesFallback(firstMove.finalState, firstMove.record.finalPieces);
  assert.ok(restored);
  assert.equal(Object.prototype.propertyIsEnumerable.call(restored, 'pieces'), true);
  assert.equal(restored.pieces, firstMove.record.finalPieces);
});
