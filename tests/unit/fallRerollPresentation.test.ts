import assert from 'node:assert/strict';
import test from 'node:test';

import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const state = {
  pieces: [
    { id: 'p1-piece-1', ownerId: 'p1', label: 'P1-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false, color: '#000' },
    { id: 'p2-piece-1', ownerId: 'p2', label: 'P2-1', nodeIndex: 1, nodeId: 'n02', started: true, finished: false, color: '#111' },
  ],
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
  ownedItems: { p1: ['reroll'] },
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
} as never;

const room = { playMode: 'individual' as const, pieceCount: 2 as const, stackedRollMode: false };
const sides = [
  { id: 'p1', team: '청팀' as const },
  { id: 'p2', team: '홍팀' as const },
];

test('fall reroll prompt survives presentation gating without advancing the turn', () => {
  const result = reduceAuthoritativeGameAction(
    state,
    {
      type: 'roll_yut',
      actorId: 'p1',
      payload: {
        rollTimingZone: 'normal',
        clientRollResult: { name: '도', steps: 1, bonus: false },
        clientFallOccurred: true,
        clientFallCount: 1,
        actorLogName: '사용자1',
      },
    } as never,
    room,
    sides,
  );

  assert.equal(result.status, 'committed');
  assert.ok('patch' in result);
  const committed = result as Extract<typeof result, { status: 'committed' }>;
  assert.equal(committed.patch.turnIndex, 0);
  assert.equal(committed.patch.itemPromptTiming, 'after_roll');
  assert.equal(committed.patch.pendingAfterMoveTurnIndex, 1);
  assert.ok(committed.patch.roll);
  assert.equal(committed.payload.turnAdvancedIndependently, false);
  assert.match(String((committed.patch.logs as Array<{ text?: string }>)[0]?.text), /다시 던지기 아이템 사용 여부/);
});
