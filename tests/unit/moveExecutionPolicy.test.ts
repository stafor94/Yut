import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canExecuteMoveActionNow,
  canExecuteScheduledMoveNow,
  getLatestMoveExecutionContextKey,
  getMoveExecutionReadinessFromDiagnosticState,
  getUnifiedMoveActionReady,
  publishMoveExecutionReadiness,
  publishMoveTransitionReadiness,
  resetMoveExecutionPolicyForTests,
  settleMoveActionClaim,
  tryClaimMoveAction,
} from '../../src/app/flows/moveExecutionPolicy.js';

function makeDiagnostic(overrides: Record<string, unknown> = {}) {
  return {
    localSeatId: 'P1',
    turnIndex: 0,
    lastAppliedSequence: 10,
    lastMovedSeatId: '',
    lastMovedPieceIds: [],
    roll: { name: '걸', steps: 3 },
    activeMovablePiece: { id: 'P1-1' },
    canRequestMove: true,
    canSubmitTurnAction: true,
    turnDeadlineKind: 'move',
    turnDeadlineAt: 10_000,
    rollResultReadyAt: 3_200,
    rollStack: [],
    selectedRollStackIndex: null,
    ...overrides,
  };
}

function makeActionKey(sequence = 10, overrides: { rollName?: string; rollSteps?: number; pieceId?: string; stackIndex?: number | null } = {}) {
  const rollName = overrides.rollName ?? '걸';
  const rollSteps = overrides.rollSteps ?? 3;
  const pieceId = overrides.pieceId ?? 'P1-1';
  const stackIndex = overrides.stackIndex ?? null;
  return `move_piece:P1:${sequence}:0:${rollName}:${rollSteps}:::${pieceId}:0:outer:stack:${stackIndex ?? 'none'}`;
}

test.beforeEach(() => resetMoveExecutionPolicyForTests());

test('UI button과 자동 이동은 동일한 transition action-ready를 사용한다', () => {
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic()));
  publishMoveTransitionReadiness({ actionReady: false, contextKey: 'move:10000' });
  const actionKey = makeActionKey();
  const scheduledContextKey = getLatestMoveExecutionContextKey();

  assert.equal(getUnifiedMoveActionReady({ canRequestMove: true, transitionActionReady: false }), false);
  assert.equal(canExecuteMoveActionNow(actionKey), false);
  assert.equal(canExecuteScheduledMoveNow(scheduledContextKey), false);

  publishMoveTransitionReadiness({ actionReady: true, contextKey: 'move:10000' });
  assert.equal(canExecuteMoveActionNow(actionKey), true);
  assert.equal(canExecuteScheduledMoveNow(scheduledContextKey), true);
});

test('action-ready 이전 예약 자동 이동과 문맥이 바뀐 callback을 차단한다', () => {
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic()));
  const scheduledContextKey = getLatestMoveExecutionContextKey();
  publishMoveTransitionReadiness({ actionReady: false, contextKey: 'hold' });
  assert.equal(canExecuteScheduledMoveNow(scheduledContextKey), false);

  publishMoveTransitionReadiness({ actionReady: true, contextKey: 'ready' });
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic({
    activeMovablePiece: { id: 'P1-2' },
  })));
  assert.equal(canExecuteScheduledMoveNow(scheduledContextKey), false);
});

test('같은 roll이 남아 있으면 lastAppliedSequence 증가만으로 두 번째 claim을 허용하지 않는다', () => {
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic()));
  publishMoveTransitionReadiness({ actionReady: true, contextKey: 'ready' });
  const firstActionKey = makeActionKey(10);
  assert.equal(tryClaimMoveAction(firstActionKey), true);

  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic({ lastAppliedSequence: 11 })));
  const sequenceOnlyChangedActionKey = makeActionKey(11);
  assert.equal(canExecuteMoveActionNow(sequenceOnlyChangedActionKey), true);
  assert.equal(tryClaimMoveAction(sequenceOnlyChangedActionKey), false);
});

test('settlement 뒤 실제 새 roll opportunity가 생성되면 다음 이동을 허용한다', () => {
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic()));
  publishMoveTransitionReadiness({ actionReady: true, contextKey: 'ready' });
  const firstActionKey = makeActionKey(10);
  assert.equal(tryClaimMoveAction(firstActionKey), true);
  assert.equal(settleMoveActionClaim(firstActionKey), true);

  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic({
    lastAppliedSequence: 12,
    roll: { name: '걸', steps: 3 },
    turnDeadlineAt: 20_000,
    rollResultReadyAt: 13_200,
    lastMovedSeatId: 'P1',
    lastMovedPieceIds: ['P1-1'],
  })));
  const nextActionKey = 'move_piece:P1:12:0:걸:3:P1:P1-1:P1-1:0:outer:stack:none';
  assert.equal(tryClaimMoveAction(nextActionKey), true);
});

test('수동 클릭과 예약 자동 이동 callback 경합에서는 하나의 claim만 성공한다', () => {
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(makeDiagnostic()));
  publishMoveTransitionReadiness({ actionReady: true, contextKey: 'ready' });
  const manualActionKey = makeActionKey(10);
  const scheduledActionKey = makeActionKey(11);

  const results = [tryClaimMoveAction(manualActionKey), tryClaimMoveAction(scheduledActionKey)];
  assert.deepEqual(results, [true, false]);
});
