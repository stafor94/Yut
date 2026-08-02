import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalMoveOwnership } from '../../src/app/flows/localMoveOwnership';
import { TURN_ACTION_TIMEOUT_MS } from '../../src/features/room/services/roomTiming';

const makeOnlineMoveState = () => ({
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
  roll: { name: '모', steps: 5, bonus: true },
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

test('patch-only 롤 snapshot 이후에도 숨긴 로컬 pieces로 지름길 이동을 계산한다', () => {
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
        clientActionId: 'move_piece:P1:10:0:모:5:first',
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(firstMove);
  assert.equal(firstMove.record.toNodeId, 'n06');
  assert.equal(Object.prototype.propertyIsEnumerable.call(firstMove.finalState, 'pieces'), false);

  const patchMergedRollState = {
    ...firstMove.finalState,
    roll: { name: '걸', steps: 3, bonus: false },
    branchChoice: 'shortcut',
    lastSequence: 12,
    turnVersion: 4,
  };
  assert.equal(Object.prototype.hasOwnProperty.call(patchMergedRollState, 'pieces'), false);

  const secondMove = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: patchMergedRollState,
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'shortcut',
        rollStackIndex: null,
        clientActionId: 'move_piece:P1:12:0:걸:3:second',
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(secondMove);
  assert.equal(secondMove.record.fromNodeId, 'n06');
  assert.ok(secondMove.record.pathNodeIds.length > 0);
  assert.equal(Object.prototype.propertyIsEnumerable.call(secondMove.finalState, 'pieces'), false);
});
