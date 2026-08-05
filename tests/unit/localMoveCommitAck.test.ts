import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthoritativeApplyWakeSnapshot } from '../../src/app/flows/authoritativeApplyWakeFlow';
import {
  classifyLocalMoveCommitAck,
  makeStatelessDuplicateRecoveryKey,
  shouldConsumeLocalMoveCommitAck,
  shouldReleaseLocalMovePending,
} from '../../src/app/flows/localMoveCommitAck';

test('실행 클라이언트가 소유한 stateful move_piece 성공 결과는 ACK로 소비한다', () => {
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P1:4',
    ownsLocalMove: true,
    status: 'committed',
    sequence: 5,
    stateAfter: { pieces: [{ id: 'P1-1', nodeId: 'n04' }] },
  }), true);
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P1:4',
    ownsLocalMove: true,
    status: 'duplicate',
    sequence: 5,
    patch: { turnIndex: 1, roll: null },
  }), true);
});

test('상태 없는 duplicate는 cursor, snapshot, fingerprint, apply-wake와 pending을 선점하지 않는다', () => {
  const duplicate = {
    actionType: 'move_piece',
    actionKey: 'move_piece:P1:4',
    ownsLocalMove: true,
    status: 'duplicate',
    sequence: 5,
    turnVersion: 8,
  };
  assert.equal(classifyLocalMoveCommitAck(duplicate), 'stateless-duplicate');
  assert.equal(shouldConsumeLocalMoveCommitAck(duplicate), false);
  let cursor = 4;
  if (shouldConsumeLocalMoveCommitAck(duplicate)) cursor = Math.max(cursor, duplicate.sequence);
  assert.equal(cursor, 4);

  const latest = { pieces: [{ id: 'P1-1', nodeId: 'n03' }], turnIndex: 0, lastSequence: 4 };
  const metadataOnlyDuplicate = {
    status: 'duplicate',
    sequence: 5,
    turnVersion: 8,
  };
  assert.equal(buildAuthoritativeApplyWakeSnapshot(metadataOnlyDuplicate, latest), null);

  assert.equal(buildAuthoritativeApplyWakeSnapshot({
    ...metadataOnlyDuplicate,
    stateAfter: { sequence: 5, turnVersion: 8, lastSequence: 5 },
  }, latest)?.lastSequence, 5);

  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: false,
    fingerprintMatched: null,
  }), false);
});

test('소유하지 않은 이동과 실패 결과는 기존 callback 파이프라인에 남긴다', () => {
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'move_piece',
    actionKey: 'move_piece:P2:4',
    ownsLocalMove: false,
    status: 'committed',
    sequence: 5,
    patch: { roll: null },
  }), false);
  for (const status of ['rejected', 'unsupported', 'committed']) {
    assert.equal(classifyLocalMoveCommitAck({
      actionType: 'move_piece',
      actionKey: 'move_piece:P1:4',
      ownsLocalMove: true,
      status,
      sequence: status === 'committed' ? 5 : 0,
    }), 'passthrough');
  }
  assert.equal(shouldConsumeLocalMoveCommitAck({
    actionType: 'roll_yut',
    actionKey: 'roll_yut:P1:4',
    ownsLocalMove: true,
    status: 'committed',
    sequence: 5,
    patch: { roll: null },
  }), false);
});

test('stateless duplicate는 직접 복구 key를 만들지 않고 기존 sequence pipeline에 위임한다', () => {
  assert.equal(makeStatelessDuplicateRecoveryKey({
    roomId: 'room-1',
    actionKey: 'move_piece:P1:4',
    sequence: 5,
  }), '');
  assert.equal(makeStatelessDuplicateRecoveryKey({
    roomId: '',
    actionKey: '',
    sequence: 0,
  }), '');
});

test('로컬 이동 pending은 presentation과 서버 검증이 모두 끝난 뒤 해제한다', () => {
  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: true,
    fingerprintMatched: true,
  }), true);

  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: false,
    serverSequenceAcked: true,
    fingerprintMatched: true,
  }), false);
  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: false,
    fingerprintMatched: true,
  }), false);
  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: true,
    fingerprintMatched: null,
  }), false);
  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: true,
    fingerprintMatched: false,
  }), false);
});
