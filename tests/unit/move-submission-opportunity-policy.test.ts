import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMoveTransitionReadinessSnapshot,
  publishMoveTransitionReadiness,
  resetMoveExecutionPolicyForTests,
} from '../../src/app/flows/moveExecutionPolicy';
import {
  getOrCreateAutoMoveOpportunity,
  isManualStackMoveSelectionCurrent,
  markAutoMoveSubmitted,
  markManualStackMoveSelection,
  resetManualStackMoveSelectionForTests,
  shouldAttemptAutoMove,
} from '../../src/app/flows/moveSubmissionOpportunityPolicy';
import {
  publishMoveSubmissionPending,
  shouldHidePendingFinalRollStackPresentation,
} from '../../src/app/flows/moveSubmissionPresentationState';
import { isTurnActionPresentationPending } from '../../src/app/flows/turnActionPresentationPolicy';

test('canonical transition readiness 전에는 auto move opportunity를 시작하지 않고 ready가 되면 추가 지연 없이 즉시 제출 가능하다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single:p1';
  const beforeReady = getOrCreateAutoMoveOpportunity(null, key, 1_000, false);
  assert.equal(beforeReady, null);
  const created = getOrCreateAutoMoveOpportunity(beforeReady, key, 1_250, true);
  assert.ok(created);
  assert.equal(created.readyAt, 1_250);
  assert.equal(shouldAttemptAutoMove({
    opportunity: created,
    key,
    now: 1_250,
    moveRequestReady: true,
    moveActionReady: true,
    transitionActionReady: true,
    submissionPending: false,
  }), true);
});

test('동일 move opportunity의 snapshot 재렌더는 최초 readyAt을 유지하고 transient not-ready에서 기회를 소비하지 않는다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single:p1';
  const created = getOrCreateAutoMoveOpportunity(null, key, 1_000, true);
  assert.ok(created);
  const afterSnapshot = getOrCreateAutoMoveOpportunity(created, key, 1_250, false);
  assert.equal(afterSnapshot, created);
  assert.equal(afterSnapshot?.readyAt, 1_000);
  assert.equal(shouldAttemptAutoMove({
    opportunity: afterSnapshot,
    key,
    now: 1_600,
    moveRequestReady: false,
    moveActionReady: false,
    transitionActionReady: false,
    submissionPending: false,
  }), false);
  assert.equal(afterSnapshot?.submitted, false);
  assert.equal(shouldAttemptAutoMove({
    opportunity: afterSnapshot,
    key,
    now: 1_600,
    moveRequestReady: true,
    moveActionReady: true,
    transitionActionReady: true,
    submissionPending: false,
  }), true);
});

test('성공 제출로 소비된 auto move opportunity는 수동 클릭·snapshot 재렌더와 경합해도 다시 실행하지 않는다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single:p1';
  const opportunity = getOrCreateAutoMoveOpportunity(null, key, 1_000, true);
  assert.ok(opportunity);
  markAutoMoveSubmitted(opportunity, key);
  assert.equal(shouldAttemptAutoMove({
    opportunity,
    key,
    now: 5_000,
    moveRequestReady: true,
    moveActionReady: true,
    transitionActionReady: true,
    submissionPending: false,
  }), false);
  assert.equal(getOrCreateAutoMoveOpportunity(opportunity, key, 9_000, true), opportunity);
});

test('수동 stacked 선택 source는 같은 authoritative roll identity에만 소유권을 유지한다', () => {
  resetManualStackMoveSelectionForTests();
  const yut = { name: '윷', steps: 4, bonus: true } as const;
  const gae = { name: '개', steps: 2 } as const;
  const backDo = { name: '빽도', steps: -1 } as const;

  assert.equal(isManualStackMoveSelectionCurrent({
    activeSeatId: 'P1',
    turnDeadlineAt: 20_000,
    rollStackIndex: 0,
    roll: yut,
  }), false);

  markManualStackMoveSelection({
    activeSeatId: 'P1',
    turnDeadlineAt: 20_000,
    rollStackIndex: 0,
    roll: yut,
  });
  assert.equal(isManualStackMoveSelectionCurrent({
    activeSeatId: 'P1',
    turnDeadlineAt: 20_000,
    rollStackIndex: 0,
    roll: yut,
  }), true);
  assert.equal(isManualStackMoveSelectionCurrent({
    activeSeatId: 'P1',
    turnDeadlineAt: 20_000,
    rollStackIndex: 0,
    roll: backDo,
  }), false);
  assert.equal(isManualStackMoveSelectionCurrent({
    activeSeatId: 'P1',
    turnDeadlineAt: 20_001,
    rollStackIndex: 0,
    roll: yut,
  }), false);

  markManualStackMoveSelection({
    activeSeatId: 'P1',
    turnDeadlineAt: 30_000,
    rollStackIndex: 1,
    roll: gae,
  });
  assert.equal(isManualStackMoveSelectionCurrent({
    activeSeatId: 'P1',
    turnDeadlineAt: 30_000,
    rollStackIndex: 1,
    roll: gae,
  }), true);
  assert.equal(isManualStackMoveSelectionCurrent({
    activeSeatId: 'P1',
    turnDeadlineAt: 30_000,
    rollStackIndex: 0,
    roll: gae,
  }), false);

  resetManualStackMoveSelectionForTests();
});

test('move transition readiness snapshot은 현재 GameBoardControls context를 그대로 보존한다', () => {
  resetMoveExecutionPolicyForTests();
  publishMoveTransitionReadiness({ actionReady: false, contextKey: 'P2:move:0:move:20000' });
  assert.deepEqual(getMoveTransitionReadinessSnapshot(), { actionReady: false, contextKey: 'P2:move:0:move:20000' });
  publishMoveTransitionReadiness({ actionReady: true, contextKey: 'P2:move:0:move:20000' });
  assert.deepEqual(getMoveTransitionReadinessSnapshot(), { actionReady: true, contextKey: 'P2:move:0:move:20000' });
});

test('move 제출 pending만 타이머 presentation을 숨기고 ACK/거부 해제 후에는 같은 deadline 표시를 복구할 수 있다', () => {
  publishMoveSubmissionPending(true);
  assert.equal(isTurnActionPresentationPending({
    phase: 'move',
    hasRoll: true,
    canRollNow: false,
    canSubmitTurnAction: true,
    rollResultHolding: false,
  }), true);

  publishMoveSubmissionPending(false);
  assert.equal(isTurnActionPresentationPending({
    phase: 'move',
    hasRoll: true,
    canRollNow: false,
    canSubmitTurnAction: true,
    rollResultHolding: false,
  }), false);
});

test('stacked roll preselection은 move request readiness와 무관하게 pending으로 오인되지 않는다', () => {
  publishMoveSubmissionPending(false);
  assert.equal(isTurnActionPresentationPending({
    phase: 'move',
    hasRoll: true,
    canRollNow: false,
    canSubmitTurnAction: true,
    rollResultHolding: false,
  }), false);
});

test('마지막 누적 윷 이동은 local move pending과 실제 이동 시작이 모두 성립한 동안에만 표시 스택을 소비한다', () => {
  const finalYutMove = {
    stackedRollMode: true,
    authoritativeRollStackLength: 1,
    rollStackClosed: true,
    moveSubmissionPending: true,
    movementStarted: true,
    isLocalTurn: true,
  };

  assert.equal(shouldHidePendingFinalRollStackPresentation(finalYutMove), true);
  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...finalYutMove, moveSubmissionPending: false }), false);
  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...finalYutMove, movementStarted: false }), false);
});

test('걸을 먼저 이동해 윷 하나가 남은 시점과 서버 거부 복구 시점에는 authoritative 마지막 스택 표시를 유지한다', () => {
  const remainingYut = {
    stackedRollMode: true,
    authoritativeRollStackLength: 1,
    rollStackClosed: true,
    moveSubmissionPending: false,
    movementStarted: false,
    isLocalTurn: true,
  };

  assert.equal(shouldHidePendingFinalRollStackPresentation(remainingYut), false);
  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...remainingYut, movementStarted: true }), false);
});

test('다중 스택·열린 스택·AI/원격 이동에는 마지막 스택 presentation 마스크를 적용하지 않는다', () => {
  const pendingMove = {
    stackedRollMode: true,
    authoritativeRollStackLength: 1,
    rollStackClosed: true,
    moveSubmissionPending: true,
    movementStarted: true,
    isLocalTurn: true,
  };

  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...pendingMove, authoritativeRollStackLength: 2 }), false);
  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...pendingMove, rollStackClosed: false }), false);
  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...pendingMove, isLocalTurn: false }), false);
  assert.equal(shouldHidePendingFinalRollStackPresentation({ ...pendingMove, stackedRollMode: false }), false);
});
