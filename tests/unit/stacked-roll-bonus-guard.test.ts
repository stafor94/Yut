import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PENDING_STACKED_BONUS_ROLL_REASON,
  canRoll,
  canSubmitTurnAction,
  getTurnActionBlockReasons,
} from '../../src/game-core/gameEngine';
import {
  clearPendingStackedBonusRoll,
  syncPendingStackedBonusRoll,
} from '../../src/game-core/stackedRollTurnGuard';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducer';

const turnGuardInput = {
  activeSeatId: 'seat-1',
  actorId: 'seat-1',
  isActorAI: false,
  isSpectator: false,
};

test('열린 보너스 이동 스택은 말 이동만 막고 다음 윷 던지기는 허용한다', () => {
  clearPendingStackedBonusRoll();
  assert.equal(canSubmitTurnAction(turnGuardInput), true);

  syncPendingStackedBonusRoll({ screen: 'game', rollStackLength: 1, rollStackClosed: false });

  assert.equal(canSubmitTurnAction(turnGuardInput), false);
  assert.ok(getTurnActionBlockReasons(turnGuardInput).includes(PENDING_STACKED_BONUS_ROLL_REASON));
  assert.equal(canRoll({ ...turnGuardInput, roll: null, rollLocked: false, rollInProgress: false }), true);

  clearPendingStackedBonusRoll();
});

test('이동 스택이 닫히거나 게임 화면을 벗어나면 말 이동 차단을 해제한다', () => {
  syncPendingStackedBonusRoll({ screen: 'game', rollStackLength: 1, rollStackClosed: true });
  assert.equal(canSubmitTurnAction(turnGuardInput), true);

  syncPendingStackedBonusRoll({ screen: 'lobby', rollStackLength: 1, rollStackClosed: false });
  assert.equal(canSubmitTurnAction(turnGuardInput), true);

  clearPendingStackedBonusRoll();
});

test('판 위에 말이 없는 상태의 윷 결과는 열린 스택으로 유지하고 다음 액션을 던지기로 둔다', () => {
  const state = {
    pieces: [
      { id: 'seat-1-piece-1', ownerId: 'seat-1', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
      { id: 'seat-2-piece-1', ownerId: 'seat-2', nodeIndex: 0, nodeId: 'n01', started: false, finished: false },
    ],
    turnIndex: 0,
    turnOrderIds: ['seat-1', 'seat-2'],
    roll: null,
    rollStack: [],
    selectedRollStackIndex: null,
    rollStackClosed: false,
    logs: [],
    winner: '',
    trapNodes: [],
    shieldedPieceIds: [],
    boardItems: [],
    ownedItems: {},
    branchChoice: 'outer',
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: null,
    pendingGoldenYutSelection: null,
    turnDeadlineAt: 0,
    turnDeadlineKind: 'roll',
  } as any;
  const room = { stackedRollMode: true, playMode: 'individual' } as any;
  const sides = [
    { id: 'seat-1', team: '청팀' },
    { id: 'seat-2', team: '홍팀' },
  ];

  const firstRoll = reduceAuthoritativeGameAction(
    state,
    {
      type: 'roll_yut',
      actorId: 'seat-1',
      payload: {
        rollTimingZone: 'normal',
        clientRollResult: { name: '윷', steps: 4, bonus: true },
        clientFallOccurred: false,
        clientFallCount: 0,
        actorLogName: 'P1',
      },
    } as any,
    room,
    sides,
  );

  assert.equal(firstRoll.status, 'committed');
  if (firstRoll.status !== 'committed') return;
  assert.equal(firstRoll.patch.roll, null);
  assert.deepEqual(firstRoll.patch.rollStack, [{ name: '윷', steps: 4, bonus: true }]);
  assert.equal(firstRoll.patch.rollStackClosed, false);
  assert.equal(firstRoll.patch.selectedRollStackIndex, null);
  assert.equal(firstRoll.patch.turnDeadlineKind, 'roll');

  const secondRoll = reduceAuthoritativeGameAction(
    { ...state, ...firstRoll.patch } as any,
    {
      type: 'roll_yut',
      actorId: 'seat-1',
      payload: {
        rollTimingZone: 'normal',
        clientRollResult: { name: '도', steps: 1 },
        clientFallOccurred: false,
        clientFallCount: 0,
        actorLogName: 'P1',
      },
    } as any,
    room,
    sides,
  );

  assert.equal(secondRoll.status, 'committed');
  if (secondRoll.status !== 'committed') return;
  assert.deepEqual(secondRoll.patch.rollStack, [
    { name: '윷', steps: 4, bonus: true },
    { name: '도', steps: 1 },
  ]);
  assert.equal(secondRoll.patch.rollStackClosed, true);
});
