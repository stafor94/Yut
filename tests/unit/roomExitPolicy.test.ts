import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasNonAiPlayer,
  hasRecoverableRoomPlayer,
  isAiSubstitutionUpdate,
  shouldDeleteRoomAfterAiSubstitution,
} from '../../src/features/room/services/roomExitPolicy';

const aiSubstitution = { isAI: true, isSubstitutedByAI: true };

test('인게임 종료의 AI 대체 업데이트를 구분한다', () => {
  assert.equal(isAiSubstitutionUpdate(aiSubstitution), true);
  assert.equal(isAiSubstitutionUpdate({ isAI: true, isSubstitutedByAI: false }), false);
  assert.equal(isAiSubstitutionUpdate({}), false);
});

test('관전자와 AI를 제외한 사람 플레이어가 남아있는지 판정한다', () => {
  assert.equal(hasNonAiPlayer([{ isAI: true }, { isSpectator: true }]), false);
  assert.equal(hasNonAiPlayer([{ isAI: true }, { isAI: false, isSpectator: false }]), true);
});

test('사람 또는 AI 대체 자리가 있으면 진행 방을 복구할 수 있다고 판정한다', () => {
  assert.equal(hasRecoverableRoomPlayer([{ isAI: false }]), true);
  assert.equal(hasRecoverableRoomPlayer([{ isAI: true, isSubstitutedByAI: true }]), true);
  assert.equal(hasRecoverableRoomPlayer([{ isAI: true }, { isSpectator: true }]), false);
});

test('마지막 사람 플레이어가 AI로 대체되면 방을 삭제한다', () => {
  assert.equal(shouldDeleteRoomAfterAiSubstitution(aiSubstitution, [
    { isAI: true },
    { isAI: true, isSpectator: false },
    { isSpectator: true },
  ]), true);
});

test('다른 사람 플레이어가 남아있으면 방을 유지한다', () => {
  assert.equal(shouldDeleteRoomAfterAiSubstitution(aiSubstitution, [
    { isAI: true },
    { isAI: false, isSpectator: false },
  ]), false);
});
