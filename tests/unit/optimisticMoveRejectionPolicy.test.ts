import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldReportRejectedPendingMoveResyncAsError,
  shouldResyncRejectedPendingMove,
} from '../../src/app/flows/optimisticMoveRejectionPolicy';

const baseInput = {
  actionType: 'move_piece',
  status: 'rejected',
  hasPendingMove: true,
};

test('rejected pending move는 authoritative resync 대상이다', () => {
  assert.equal(shouldResyncRejectedPendingMove(baseInput), true);
});

test('이미 소비된 deadline-auto move의 deadline mismatch는 resync하되 오류로 보고하지 않는다', () => {
  const input = {
    ...baseInput,
    reason: '자동 입력 대상 제한시간이 현재 상태와 일치하지 않습니다.',
  };
  assert.equal(shouldResyncRejectedPendingMove(input), true);
  assert.equal(shouldReportRejectedPendingMoveResyncAsError(input), false);
});

test('일반 move rejection과 unsupported는 기존처럼 오류 resync로 보고한다', () => {
  assert.equal(shouldReportRejectedPendingMoveResyncAsError({
    ...baseInput,
    reason: '말 이동이 거부되었습니다.',
  }), true);
  assert.equal(shouldReportRejectedPendingMoveResyncAsError({
    ...baseInput,
    status: 'unsupported',
    reason: '지원하지 않는 액션입니다.',
  }), true);
});
