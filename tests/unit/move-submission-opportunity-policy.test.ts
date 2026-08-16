import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMoveTransitionReadinessSnapshot,
  publishMoveTransitionReadiness,
  resetMoveExecutionPolicyForTests,
} from '../../src/app/flows/moveExecutionPolicy';
import {
  getOrCreateAutoMoveOpportunity,
  markAutoMoveSubmitted,
  shouldAttemptAutoMove,
} from '../../src/app/flows/moveSubmissionOpportunityPolicy';
import { publishMoveSubmissionPending } from '../../src/app/flows/moveSubmissionPresentationState';
import { isTurnActionPresentationPending } from '../../src/app/flows/turnActionPresentationPolicy';

test('canonical transition readiness 전에는 auto move opportunity를 시작하지 않고 ready 이후 최초 500ms 기준을 만든다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single:p1';
  const beforeReady = getOrCreateAutoMoveOpportunity(null, key, 1_000, 500, false);
  assert.equal(beforeReady, null);
  const created = getOrCreateAutoMoveOpportunity(beforeReady, key, 1_250, 500, true);
  assert.ok(created);
  assert.equal(created.readyAt, 1_750);
});

test('동일 move opportunity의 snapshot 재렌더는 readyAt을 유지하고 transient not-ready에서 기회를 소비하지 않는다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single:p1';
  const created = getOrCreateAutoMoveOpportunity(null, key, 1_000, 500, true);
  assert.ok(created);
  const afterSnapshot = getOrCreateAutoMoveOpportunity(created, key, 1_250, 500, false);
  assert.equal(afterSnapshot, created);
  assert.equal(afterSnapshot?.readyAt, 1_500);
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
  const opportunity = getOrCreateAutoMoveOpportunity(null, key, 1_000, 500, true);
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
  assert.equal(getOrCreateAutoMoveOpportunity(opportunity, key, 9_000, 500, true), opportunity);
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
