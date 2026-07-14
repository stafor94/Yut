import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const state = {
  pieces: [
    { id: 'p1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: true, finished: false },
    { id: 'p2', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    { id: 'p3', ownerId: 'seat-3', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
  ],
  turnIndex: 0,
  turnOrderIds: ['seat-1', 'seat-2', 'seat-3'],
  initialTurnOrderIds: ['seat-1', 'seat-2', 'seat-3'],
  completedSeatIds: [],
  rankingSeatIds: [],
  gameEndMode: '' as const,
  lastFinishedSeatId: '',
  continuationRound: 0,
  roll: { name: '도', steps: 1 },
  rollStack: [],
  selectedRollStackIndex: null,
  rollStackClosed: false,
  boardItems: [],
  ownedItems: {},
  trapNodes: [],
  shieldedPieceIds: [],
  logs: [],
  winner: '',
  branchChoice: 'outer' as const,
  itemPromptTiming: null,
  pendingAfterMoveTurnIndex: null,
  pendingGoldenYutSelection: null,
  pendingTrapPlacement: null,
  turnDeadlineAt: 0,
  turnDeadlineKind: 'move' as const,
};

const sides = [
  { id: 'seat-1', team: '청팀' as const },
  { id: 'seat-2', team: '홍팀' as const },
  { id: 'seat-3', team: '청팀' as const },
];

test('3인 이상 개인전도 첫 완주자가 나오면 순위전을 열지 않고 최종 종료한다', () => {
  const result = reduceAuthoritativeGameAction(
    state,
    {
      type: 'move_piece',
      actorId: 'seat-1',
      payload: {
        pieceId: 'p1',
        branchChoice: 'outer',
        extraSteps: 0,
        actorLogName: 'P1',
      },
    },
    { playMode: 'individual', pieceCount: 1, stackedRollMode: false },
    sides,
  );

  assert.equal(result.status, 'committed');
  if (result.status !== 'committed') return;
  assert.equal(result.patch.winner, 'P1 승리');
  assert.equal(result.patch.gameEndMode, 'final');
  assert.equal(result.payload.gameEndMode, 'final');
  assert.deepEqual(result.patch.rankingSeatIds, ['seat-1']);
});
