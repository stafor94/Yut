import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingOptimisticMoveActions,
  forgetPendingOptimisticMoveAction,
  getPendingOptimisticMoveAction,
  rememberPendingOptimisticMoveAction,
} from '../../src/app/hooks/usePendingRemoteActions';
import {
  MOVE_TIMEOUT_RECOVERY_RETRY_LIMIT,
  canRetryMoveTimeoutRecovery,
  classifyMoveTimeoutRecoveryResult,
  getMoveTimeoutRecoverySchedule,
  isMoveTimeoutRecoveryScopeCurrent,
  shouldDeferMoveTimeoutRecoveryForPendingMove,
  type MoveTimeoutRecoveryScope,
} from '../../src/features/room/services/moveTimeoutRecoveryPolicy';

const deadlineAt = 10_000;
const baseScope: MoveTimeoutRecoveryScope = {
  roomId: 'room-1',
  actorId: 'seat-1',
  turnDeadlineKind: 'move',
  turnDeadlineAt: deadlineAt,
  coordinatorSeatId: 'seat-2',
  coordinatorEpoch: 7,
};

test('deadline + grace 직전에는 기다리고 정확한 시각부터 recovery가 가능하다', () => {
  assert.deepEqual(getMoveTimeoutRecoverySchedule(deadlineAt, 10_999), {
    recoveryAt: 11_000,
    ready: false,
    delayMs: 1,
  });
  assert.deepEqual(getMoveTimeoutRecoverySchedule(deadlineAt, 11_000), {
    recoveryAt: 11_000,
    ready: true,
    delayMs: 0,
  });
});

test('effect 활성화 시점과 표시 제한시간이 달라도 authoritative recoveryAt은 절대 deadline으로 고정된다', () => {
  const activatedAfterPresentation = getMoveTimeoutRecoverySchedule(deadlineAt, 8_750);
  const fiveSecondDisplayActivation = getMoveTimeoutRecoverySchedule(deadlineAt, 6_000);
  const tenSecondDisplayActivation = getMoveTimeoutRecoverySchedule(deadlineAt, 1_000);

  assert.equal(activatedAfterPresentation.recoveryAt, 11_000);
  assert.equal(activatedAfterPresentation.delayMs, 2_250);
  assert.equal(fiveSecondDisplayActivation.recoveryAt, tenSecondDisplayActivation.recoveryAt);
});

test('deadline 전에 시작한 같은 actor의 optimistic 이동은 stale 전까지 timeout recovery보다 우선한다', () => {
  const pendingMove = { actorId: 'seat-1', createdAt: deadlineAt - 500 };
  assert.equal(shouldDeferMoveTimeoutRecoveryForPendingMove({
    pendingMove,
    actorId: 'seat-1',
    turnDeadlineAt: deadlineAt,
    now: deadlineAt + 1_000,
    staleAfterMs: 30_000,
  }), true);
  assert.equal(shouldDeferMoveTimeoutRecoveryForPendingMove({
    pendingMove,
    actorId: 'seat-2',
    turnDeadlineAt: deadlineAt,
    now: deadlineAt + 1_000,
    staleAfterMs: 30_000,
  }), false);
  assert.equal(shouldDeferMoveTimeoutRecoveryForPendingMove({
    pendingMove: { actorId: 'seat-1', createdAt: deadlineAt + 1 },
    actorId: 'seat-1',
    turnDeadlineAt: deadlineAt,
    now: deadlineAt + 1_000,
    staleAfterMs: 30_000,
  }), false);
  assert.equal(shouldDeferMoveTimeoutRecoveryForPendingMove({
    pendingMove,
    actorId: 'seat-1',
    turnDeadlineAt: deadlineAt,
    now: pendingMove.createdAt + 30_000,
    staleAfterMs: 30_000,
  }), false);
});

test('optimistic move registry는 actor별 최신 pending만 반환하고 settle 시 제거한다', () => {
  clearPendingOptimisticMoveActions();
  assert.equal(rememberPendingOptimisticMoveAction({ actionKey: 'move_piece:seat-1:old', actorId: 'seat-1', createdAt: 1_000 }), true);
  assert.equal(rememberPendingOptimisticMoveAction({ actionKey: 'move_piece:seat-1:new', actorId: 'seat-1', createdAt: 2_000 }), true);
  assert.equal(rememberPendingOptimisticMoveAction({ actionKey: 'move_piece:seat-2', actorId: 'seat-2', createdAt: 3_000 }), true);
  assert.deepEqual(getPendingOptimisticMoveAction('seat-1'), {
    actionKey: 'move_piece:seat-1:new',
    actorId: 'seat-1',
    createdAt: 2_000,
  });
  assert.equal(forgetPendingOptimisticMoveAction('move_piece:seat-1:new'), true);
  assert.deepEqual(getPendingOptimisticMoveAction('seat-1'), {
    actionKey: 'move_piece:seat-1:old',
    actorId: 'seat-1',
    createdAt: 1_000,
  });
  clearPendingOptimisticMoveActions();
  assert.equal(getPendingOptimisticMoveAction('seat-1'), undefined);
});

test('timer callback은 room·actor·phase·deadline·coordinator seat·epoch가 모두 같은 경우만 유효하다', () => {
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope }), true);
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope, roomId: 'room-2' }), false);
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope, actorId: 'seat-3' }), false);
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope, turnDeadlineKind: 'roll' }), false);
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope, turnDeadlineAt: deadlineAt + 1 }), false);
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope, coordinatorSeatId: 'seat-3' }), false);
  assert.equal(isMoveTimeoutRecoveryScopeCurrent(baseScope, { ...baseScope, coordinatorEpoch: 8 }), false);
});

test('commit과 duplicate만 terminal이며 조기 실행과 authoritative mismatch는 재평가 대상으로 분류한다', () => {
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'committed' }), 'terminal');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'duplicate' }), 'terminal');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'rejected', reason: '시간초과 네트워크 유예 시간이 아직 남아 있습니다.' }), 'too-early');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'rejected', reason: 'coordinator lease가 만료되었거나 epoch가 일치하지 않습니다.' }), 'retryable-state');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'rejected', reason: 'authoritative sequence가 변경되어 최신 상태 재평가가 필요합니다.' }), 'retryable-state');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'rejected', reason: '시간초과 상태가 아닙니다.' }), 'retryable-state');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'rejected', reason: '시간초과 대상 deadline이 아닙니다.' }), 'retryable-state');
  assert.equal(classifyMoveTimeoutRecoveryResult({ status: 'rejected', reason: '영구적으로 유효하지 않은 이동입니다.' }), 'permanent');
});

test('복구 가능한 실패도 제한 횟수까지만 재시도한다', () => {
  assert.equal(canRetryMoveTimeoutRecovery('too-early', 0), true);
  assert.equal(canRetryMoveTimeoutRecovery('retryable-state', MOVE_TIMEOUT_RECOVERY_RETRY_LIMIT - 1), true);
  assert.equal(canRetryMoveTimeoutRecovery('retryable-state', MOVE_TIMEOUT_RECOVERY_RETRY_LIMIT), false);
  assert.equal(canRetryMoveTimeoutRecovery('permanent', 0), false);
  assert.equal(canRetryMoveTimeoutRecovery('terminal', 0), false);
});
