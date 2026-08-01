import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRollResultReadyAt } from '../../src/app/appUtils';
import {
  canExecuteMoveActionNow,
  getMoveExecutionReadinessFromDiagnosticState,
  isMoveActionAlreadyClaimed,
  publishMoveExecutionReadiness,
  shouldExecuteScheduledMove,
} from '../../src/app/flows/moveExecutionPolicy';
import { shouldResyncRejectedPendingMove } from '../../src/app/flows/optimisticMoveRejectionPolicy';
import { ONLINE_ROLL_FAST_PRESENTATION_MS } from '../../src/features/room/services/rollPresentationTiming';

test('authoritative 온라인 roll의 전체 4.8초 presentation readyAt을 유효하게 유지한다', () => {
  const now = 100_000;
  const readyAt = now + ONLINE_ROLL_FAST_PRESENTATION_MS;
  assert.equal(normalizeRollResultReadyAt(readyAt, now), readyAt);
  assert.equal(normalizeRollResultReadyAt(readyAt + 1, now), 0);
  assert.equal(normalizeRollResultReadyAt(now, now), 0);
});

test('pending move 거부는 잠금 해제 전에 authoritative 재동기화한다', () => {
  assert.equal(shouldResyncRejectedPendingMove({ actionType: 'move_piece', status: 'rejected', hasPendingMove: true }), true);
  assert.equal(shouldResyncRejectedPendingMove({ actionType: 'move_piece', status: 'unsupported', hasPendingMove: true }), true);
  assert.equal(shouldResyncRejectedPendingMove({ actionType: 'move_piece', status: 'committed', hasPendingMove: true }), false);
  assert.equal(shouldResyncRejectedPendingMove({ actionType: 'roll_yut', status: 'rejected', hasPendingMove: true }), false);
  assert.equal(shouldResyncRejectedPendingMove({ actionType: 'move_piece', status: 'rejected', hasPendingMove: false }), false);
});

test('예약된 자동 이동은 콜백 실행 시 최신 action-ready와 동일한 이동 문맥을 다시 확인한다', () => {
  const scheduledContextKey = 'move_piece:seat-a:7:2:걸:3:seat-z:piece-z:piece-1';
  assert.equal(shouldExecuteScheduledMove({
    canRequestMove: true,
    scheduledContextKey,
    latestContextKey: scheduledContextKey,
  }), true);
  assert.equal(shouldExecuteScheduledMove({
    canRequestMove: false,
    scheduledContextKey,
    latestContextKey: scheduledContextKey,
  }), false);
  assert.equal(shouldExecuteScheduledMove({
    canRequestMove: true,
    scheduledContextKey,
    latestContextKey: 'move_piece:seat-a:8:3:개:2::piece-1:piece-2',
  }), false);
});

test('실행 직전 게시된 최종 canRequestMove와 이동 문맥으로 stale 콜백을 차단한다', () => {
  const actionKey = 'move_piece:seat-a:7:2:걸:3:seat-z:piece-z:piece-1:0:outer:stack:none';
  const matchingDiagnostic = {
    canRequestMove: true,
    localSeatId: 'seat-a',
    lastAppliedSequence: 7,
    turnIndex: 2,
    roll: { name: '걸', steps: 3 },
    lastMovedSeatId: 'seat-z',
    lastMovedPieceIds: ['piece-z'],
    activeMovablePiece: { id: 'piece-1' },
  };
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(matchingDiagnostic));
  assert.equal(canExecuteMoveActionNow(actionKey), true);

  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState({ ...matchingDiagnostic, canRequestMove: false }));
  assert.equal(canExecuteMoveActionNow(actionKey), false);

  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState({ ...matchingDiagnostic, turnIndex: 3 }));
  assert.equal(canExecuteMoveActionNow(actionKey), false);
});

test('누적 던지기 선택 이동의 ready action key도 정상 실행한다', () => {
  const actionKey = 'move_piece:seat-a:11:4:ready:seat-z:piece-z:piece-2:0:outer:stack:1';
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState({
    canRequestMove: true,
    localSeatId: 'seat-a',
    lastAppliedSequence: 11,
    turnIndex: 4,
    roll: null,
    lastMovedSeatId: 'seat-z',
    lastMovedPieceIds: ['piece-z'],
    activeMovablePiece: { id: 'piece-2' },
  }));
  assert.equal(canExecuteMoveActionNow(actionKey), true);
});

test('이동 가능한 말이 없는 빽도 통과 action key도 정상 실행한다', () => {
  const actionKey = 'move_piece:seat-a:12:5:빽도:-1:seat-z:piece-z::0:outer:stack:none';
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState({
    canRequestMove: true,
    localSeatId: 'seat-a',
    lastAppliedSequence: 12,
    turnIndex: 5,
    roll: { name: '빽도', steps: -1 },
    lastMovedSeatId: 'seat-z',
    lastMovedPieceIds: ['piece-z'],
    activeMovablePiece: null,
  }));
  assert.equal(canExecuteMoveActionNow(actionKey), true);
});

test('기존 local client mutation id가 동일한 논리 이동의 재요청·낙관적 이동·연출을 차단한다', () => {
  const claimedActionKeys = new Set<string>();
  const moveActionKey = 'move_piece:seat:7:2:걸:3:piece-1';
  assert.equal(isMoveActionAlreadyClaimed(moveActionKey, claimedActionKeys), false);
  claimedActionKeys.add(moveActionKey);
  assert.equal(isMoveActionAlreadyClaimed(moveActionKey, claimedActionKeys), true);
  assert.equal(isMoveActionAlreadyClaimed(`${moveActionKey}:next-turn`, claimedActionKeys), false);
  assert.equal(isMoveActionAlreadyClaimed('roll_yut:seat:7:2', claimedActionKeys), false);
});
