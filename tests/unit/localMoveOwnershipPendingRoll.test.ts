import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeLocalMoveResultFingerprint,
  prepareLocalMoveOwnership,
} from '../../src/app/flows/localMoveOwnership';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const makePreRollSyncedState = () => ({
  playMode: 'individual' as const,
  pieceCount: 1 as const,
  stackedRollMode: false,
  gameSeats: [
    { id: 'P1', team: '청팀' as const },
    { id: 'P2', team: '홍팀' as const },
  ],
  turnOrderIds: ['P1', 'P2'],
  turnIndex: 0,
  pieces: [
    { id: 'piece-1', ownerId: 'P1', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
    { id: 'piece-2', ownerId: 'P2', nodeId: 'n01', nodeIndex: 0, started: false, finished: false, previousNodeId: '' },
  ],
  roll: null,
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  branchChoice: 'outer' as const,
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
  turnDeadlineKind: 'roll' as const,
  turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
  lastSequence: 10,
  turnVersion: 3,
});

const prepareGulMove = () => prepareLocalMoveOwnership({
  roomId: 'room-a',
  state: makePreRollSyncedState(),
  action: {
    type: 'move_piece',
    actorId: 'P1',
    payload: {
      pieceId: 'piece-1',
      extraSteps: 0,
      branchChoice: 'outer',
      rollStackIndex: null,
      clientActionId: 'move_piece:P1:10:0:걸:3:::piece-1:0:outer:stack:none',
      clientActionStartedAt: Date.now(),
    },
  },
});

test('빠른 ACK 전에 synced roll이 늦어도 local action identity로 move ledger 결과를 준비한다', () => {
  const prepared = prepareGulMove();

  assert.ok(prepared);
  assert.deepEqual(prepared.record.pathNodeIds, ['n02', 'n03', 'n04']);
  assert.equal(prepared.record.fromNodeId, 'n01');
  assert.equal(prepared.record.toNodeId, 'n04');
  const movedPiece = prepared.finalState.pieces?.find((piece) => (piece as { id?: string }).id === 'piece-1') as { nodeId?: string } | undefined;
  assert.equal(movedPiece?.nodeId, 'n04');
  assert.equal(prepared.finalState.roll, null);
  assert.equal(prepared.finalState.turnIndex, 1);
});

test('local reducer final pieces는 fingerprint에 보존하되 화면 적용용 spread에는 포함하지 않는다', () => {
  const prepared = prepareGulMove();

  assert.ok(prepared);
  assert.equal(Object.prototype.propertyIsEnumerable.call(prepared.finalState, 'pieces'), false);
  assert.deepEqual(prepared.finalState.pieces, prepared.record.finalPieces);
  assert.equal(makeLocalMoveResultFingerprint(prepared.finalState), prepared.record.resultFingerprint);

  const displayState = { ...prepared.finalState };
  assert.equal('pieces' in displayState, false);
  assert.equal(displayState.turnIndex, 1);
  assert.equal(displayState.roll, null);
});

test('roll 정보가 없는 비표준 move id는 local ownership을 추측하지 않는다', () => {
  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: makePreRollSyncedState(),
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        branchChoice: 'outer',
        clientActionId: 'move_piece:P1:legacy',
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.equal(prepared, null);
});
