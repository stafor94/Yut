import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldConsumeLocalMoveCommitAck } from '../../src/app/flows/localMoveCommitAck';

test('실행 클라이언트가 소유한 move_piece 성공 결과는 ACK로 소비한다', () => {
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P1:4',
    ownsLocalMove: true,
    status: 'committed',
    sequence: 5,
  }), true);
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P1:4',
    ownsLocalMove: true,
    status: 'duplicate',
    sequence: 5,
  }), true);
});

test('소유하지 않은 이동과 실패 결과는 기존 callback 파이프라인에 남긴다', () => {
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P2:4',
    ownsLocalMove: false,
    status: 'committed',
    sequence: 5,
  }), false);
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P1:4',
    ownsLocalMove: true,
    status: 'rejected',
    sequence: 0,
  }), false);
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'roll_yut',
    actionKey: 'roll_yut:P1:4',
    ownsLocalMove: true,
    status: 'committed',
    sequence: 5,
  }), false);
});
