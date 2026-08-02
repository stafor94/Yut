import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction,
  type AuthoritativeSeatSide,
} from '../../src/features/room/services/roomAuthoritativeReducer';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const GEOL = '걸';

const makeHiddenPiecesState = () => {
  const pieces = [
    {
      id: 'piece-1',
      ownerId: 'P1',
      nodeId: 'n06',
      nodeIndex: 5,
      started: true,
      finished: false,
      previousNodeId: 'n05',
    },
    {
      id: 'piece-2',
      ownerId: 'P2',
      nodeId: 'n01',
      nodeIndex: 0,
      started: false,
      finished: false,
      previousNodeId: '',
    },
  ];
  const state = {
    pieces,
    turnIndex: 0,
    turnOrderIds: ['P1', 'P2'],
    roll: null,
    rollStack: [{ name: GEOL, steps: 3, bonus: false }],
    selectedRollStackIndex: 0,
    rollStackClosed: true,
    boardItems: [],
    trapNodes: [],
    shieldedPieceIds: [],
    logs: [],
    winner: '',
    branchChoice: 'outer',
    ownedItems: {},
    pendingItemPickup: null,
    pendingTrapPlacement: null,
    itemPromptTiming: null,
    lastMovedPieceIds: [],
    lastMovedSeatId: '',
    completedSeatIds: [],
    rankingSeatIds: [],
    gameEndMode: '',
    lastFinishedSeatId: '',
    pendingGoldenYutSelection: null,
    turnDeadlineKind: 'move',
    turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
    turnActionTimeoutCountBySeatId: {},
    autoPlayBySeatId: {},
  } as Parameters<typeof reduceAuthoritativeGameAction>[0];

  Object.defineProperty(state, 'pieces', {
    value: pieces,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return state;
};

test('keeps hidden pieces available during stacked roll reduction', () => {
  const state = makeHiddenPiecesState();
  const sides: AuthoritativeSeatSide[] = [
    { id: 'P1', team: '청팀' },
    { id: 'P2', team: '홍팀' },
  ];
  const startedAt = Date.now();

  assert.equal(Object.prototype.propertyIsEnumerable.call(state, 'pieces'), false);
  const reduction = reduceAuthoritativeGameAction(
    state,
    {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        branchChoice: 'outer',
        extraSteps: 0,
        rollStackIndex: 0,
        clientActionId: `move_piece:P1:11:0:${GEOL}:3:hidden-stack`,
        clientActionStartedAt: startedAt,
      },
    },
    { playMode: 'individual', pieceCount: 1, stackedRollMode: true },
    sides,
  );

  assert.ok(isAuthoritativeCommitReduction(reduction));
  assert.ok(Array.isArray(reduction.patch.pieces));
  assert.equal(Object.prototype.propertyIsEnumerable.call(state, 'pieces'), false);
});
