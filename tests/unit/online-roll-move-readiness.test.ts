import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRollResultReadyAt } from '../../src/app/appUtils';
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
