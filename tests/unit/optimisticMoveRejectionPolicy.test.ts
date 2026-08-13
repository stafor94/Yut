import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupersededDeadlineAutoMoveRejection,
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

test('이미 소비된 deadline-auto move의 deadline mismatch만 정상 supersede로 분류한다', () => {
  assert.equal(
    isSupersededDeadlineAutoMoveRejection('자동 입력 대상 제한시간이 현재 상태와 일치하지 않습니다.'),
    true,
  );
  assert.equal(isSupersededDeadlineAutoMoveRejection('말 이동이 거부되었습니다.'), false);
  assert.equal(isSupersededDeadlineAutoMoveRejection(undefined), false);
});

test('unsupported pending move도 기존처럼 resync 대상이다', () => {
  assert.equal(shouldResyncRejectedPendingMove({
    ...baseInput,
    status: 'unsupported',
  }), true);
});
