import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginMoveSubmissionPresentation,
  getOrCreateAutoMoveOpportunity,
  reconcileMoveSubmissionPresentation,
  shouldAttemptAutoMove,
} from '../../src/app/flows/moveSubmissionOpportunityPolicy';

test('동일 move opportunity의 snapshot 재렌더는 readyAt을 유지하고 transient not-ready에서 기회를 소비하지 않는다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single';
  const created = getOrCreateAutoMoveOpportunity(null, key, 1_000, 500);
  assert.ok(created);
  const afterSnapshot = getOrCreateAutoMoveOpportunity(created, key, 1_250, 500);
  assert.equal(afterSnapshot, created);
  assert.equal(afterSnapshot?.readyAt, 1_500);
  assert.equal(shouldAttemptAutoMove({
    opportunity: afterSnapshot,
    key,
    now: 1_600,
    moveRequestReady: false,
    moveActionReady: false,
    submissionPending: false,
  }), false);
  assert.equal(afterSnapshot?.submitted, false);
  assert.equal(shouldAttemptAutoMove({
    opportunity: afterSnapshot,
    key,
    now: 1_600,
    moveRequestReady: true,
    moveActionReady: true,
    submissionPending: false,
  }), true);
});

test('accepted move pending은 느린 ACK 동안 유지되고 같은 deadline의 거부 복구에서만 해제된다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single';
  const accepted = beginMoveSubmissionPresentation(key);
  assert.deepEqual(accepted, { key, sawRequestBlocked: false });

  const blocked = reconcileMoveSubmissionPresentation(accepted, {
    currentKey: key,
    isMyTurn: true,
    moveRequestReady: false,
    movingPieceActive: true,
  });
  assert.deepEqual(blocked, { key, sawRequestBlocked: true });

  const animationFinishedBeforeAck = reconcileMoveSubmissionPresentation(blocked, {
    currentKey: key,
    isMyTurn: true,
    moveRequestReady: false,
    movingPieceActive: false,
  });
  assert.deepEqual(animationFinishedBeforeAck, { key, sawRequestBlocked: true });

  const rejectedAndRecovered = reconcileMoveSubmissionPresentation(animationFinishedBeforeAck, {
    currentKey: key,
    isMyTurn: true,
    moveRequestReady: true,
    movingPieceActive: false,
  });
  assert.equal(rejectedAndRecovered, null);
});

test('성공 제출로 소비된 auto move opportunity는 수동 클릭·snapshot 재렌더와 경합해도 다시 실행하지 않는다', () => {
  const key = 'room-1:seat-2:20000:걸:3:single';
  const opportunity = getOrCreateAutoMoveOpportunity(null, key, 1_000, 500);
  assert.ok(opportunity);
  opportunity.submitted = true;
  assert.equal(shouldAttemptAutoMove({
    opportunity,
    key,
    now: 5_000,
    moveRequestReady: true,
    moveActionReady: true,
    submissionPending: false,
  }), false);
  assert.equal(getOrCreateAutoMoveOpportunity(opportunity, key, 9_000, 500), opportunity);
});
