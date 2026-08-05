import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthoritativeApplyWakeSnapshot } from '../../src/app/flows/authoritativeApplyWakeFlow';
import {
  classifyLocalMoveCommitAck,
  makeStatelessDuplicateRecoveryKey,
  shouldConsumeLocalMoveCommitAck,
  shouldReleaseLocalMovePending,
} from '../../src/app/flows/localMoveCommitAck';

const ownedMove = {
  actionType: 'move_piece',
  actionKey: 'move_piece:P1:4',
  ownsLocalMove: true,
};

test('실행 클라이언트가 소유한 stateful move_piece 성공 결과는 ACK로 소비한다', () => {
  for (const result of [
    { status: 'committed', sequence: 5, stateAfter: { pieces: [{ id: 'P1-1', nodeId: 'n04' }] } },
    { status: 'duplicate', sequence: 5, patch: { turnIndex: 1, roll: null } },
  ]) assert.equal(shouldConsumeLocalMoveCommitAck({ ...ownedMove, ...result }), true);
});

test('상태 없는 duplicate는 cursor, apply-wake와 pending을 선점하지 않는다', () => {
  const duplicate = { ...ownedMove, status: 'duplicate', sequence: 5, turnVersion: 8 };
  assert.equal(classifyLocalMoveCommitAck(duplicate), 'stateless-duplicate');
  assert.equal(shouldConsumeLocalMoveCommitAck(duplicate), false);
  const latest = { pieces: [{ id: 'P1-1', nodeId: 'n03' }], turnIndex: 0, lastSequence: 4 };
  const metadata = { status: 'duplicate', sequence: 5, turnVersion: 8 };
  assert.equal(buildAuthoritativeApplyWakeSnapshot(metadata, latest), null);
  assert.equal(buildAuthoritativeApplyWakeSnapshot({
    ...metadata,
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
    ...ownedMove,
    actionKey: 'move_piece:P2:4',
    ownsLocalMove: false,
    status: 'committed',
    sequence: 5,
    patch: { roll: null },
  }), false);
  for (const [status, sequence] of [['rejected', 0], ['unsupported', 0], ['committed', 5]] as const) {
    assert.equal(classifyLocalMoveCommitAck({ ...ownedMove, status, sequence }), 'passthrough');
  }
  assert.equal(shouldConsumeLocalMoveCommitAck({
    ...ownedMove,
    actionType: 'roll_yut',
    actionKey: 'roll_yut:P1:4',
    status: 'committed',
    sequence: 5,
    patch: { roll: null },
  }), false);
});

test('stateless duplicate 복구 key는 roomId + actionId + sequence를 사용한다', () => {
  const key = (roomId = 'room-1', actionKey = ownedMove.actionKey, sequence = 5) => (
    makeStatelessDuplicateRecoveryKey({ roomId, actionKey, sequence })
  );
  assert.equal(key(), key());
  assert.notEqual(key(), key('room-2'));
  assert.notEqual(key(), key('room-1', 'move_piece:P1:5'));
  assert.notEqual(key(), key('room-1', ownedMove.actionKey, 6));
});

test('로컬 이동 pending은 presentation과 서버 검증이 모두 끝난 뒤 해제한다', () => {
  const releases = (localPresentationCompleted, serverSequenceAcked, fingerprintMatched) => (
    shouldReleaseLocalMovePending({ localPresentationCompleted, serverSequenceAcked, fingerprintMatched })
  );
  assert.equal(releases(true, true, true), true);
  assert.equal(releases(false, true, true), false);
  assert.equal(releases(true, false, true), false);
  assert.equal(releases(true, true, null), false);
  assert.equal(releases(true, true, false), false);
});
