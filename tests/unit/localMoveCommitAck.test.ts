import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthoritativeApplyWakeSnapshot } from '../../src/app/flows/authoritativeApplyWakeFlow';
import {
  classifyLocalMoveCommitAck,
  makeStatelessDuplicateRecoveryKey,
  shouldConsumeLocalMoveCommitAck,
  shouldReleaseLocalMovePending,
} from '../../src/app/flows/localMoveCommitAck';

const ownedMove = (overrides: Record<string, unknown> = {}) => ({
  actionType: 'move_piece',
  actionKey: 'move_piece:P1:4',
  ownsLocalMove: true,
  status: 'committed',
  sequence: 5,
  ...overrides,
});

test('stateful move 성공 결과만 로컬 ACK로 소비한다', () => {
  assert.equal(shouldConsumeLocalMoveCommitAck(ownedMove({ stateAfter: { pieces: [] } })), true);
  assert.equal(shouldConsumeLocalMoveCommitAck(ownedMove({ status: 'duplicate', patch: { roll: null } })), true);
  assert.equal(classifyLocalMoveCommitAck(ownedMove()), 'passthrough');
});

test('metadata-only duplicate는 cursor와 apply-wake를 선점하지 않고 sequence pipeline에 위임한다', () => {
  const duplicate = ownedMove({ status: 'duplicate', turnVersion: 8 });
  assert.equal(classifyLocalMoveCommitAck(duplicate), 'stateless-duplicate');
  assert.equal(shouldConsumeLocalMoveCommitAck(duplicate), false);
  assert.equal(makeStatelessDuplicateRecoveryKey({ roomId: 'room-1', actionKey: 'move_piece:P1:4', sequence: 5 }), '');
  assert.equal(buildAuthoritativeApplyWakeSnapshot(
    { status: 'duplicate', sequence: 5, turnVersion: 8 },
    { pieces: [{ id: 'P1-1', nodeId: 'n03' }], lastSequence: 4 },
  ), null);
  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: false,
    fingerprintMatched: null,
  }), false);
});

test('소유하지 않은 이동과 실패 결과는 기존 callback 파이프라인에 남긴다', () => {
  assert.equal(classifyLocalMoveCommitAck(ownedMove({ ownsLocalMove: false, patch: { roll: null } })), 'passthrough');
  assert.equal(classifyLocalMoveCommitAck(ownedMove({ status: 'rejected', sequence: 0 })), 'passthrough');
  assert.equal(classifyLocalMoveCommitAck(ownedMove({ actionType: 'roll_yut', patch: { roll: null } })), 'passthrough');
});

test('pending은 presentation, sequence ACK, fingerprint 검증이 모두 끝난 뒤 해제한다', () => {
  assert.equal(shouldReleaseLocalMovePending({
    localPresentationCompleted: true,
    serverSequenceAcked: true,
    fingerprintMatched: true,
  }), true);
  for (const pending of [
    { localPresentationCompleted: false, serverSequenceAcked: true, fingerprintMatched: true },
    { localPresentationCompleted: true, serverSequenceAcked: false, fingerprintMatched: true },
    { localPresentationCompleted: true, serverSequenceAcked: true, fingerprintMatched: null },
    { localPresentationCompleted: true, serverSequenceAcked: true, fingerprintMatched: false },
  ]) assert.equal(shouldReleaseLocalMovePending(pending), false);
});
