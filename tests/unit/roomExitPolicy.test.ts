import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasNonAiPlayer,
  hasRecoverableRoomPlayer,
  isAiSubstitutionUpdate,
  isRoomExitInGame,
  shouldDeferRoomExitCleanup,
  shouldStartRoomDeletionGraceAfterAiSubstitution,
  shouldSubstituteRoomPlayerAsAi,
} from '../../src/features/room/services/roomExitPolicy';

const aiSubstitution = { isAI: true, isSubstitutedByAI: true };

test('인게임 종료의 AI 대체 업데이트를 구분한다', () => {
  assert.equal(isAiSubstitutionUpdate(aiSubstitution), true);
  assert.equal(isAiSubstitutionUpdate({ isAI: true, isSubstitutedByAI: false }), false);
  assert.equal(isAiSubstitutionUpdate({}), false);
});

test('관전자도 AI가 아닌 인간으로 판정한다', () => {
  assert.equal(hasNonAiPlayer([{ isAI: true }, { isSpectator: true }]), true);
  assert.equal(hasNonAiPlayer([{ isAI: true }, { isAI: true, isSpectator: false }]), false);
});

test('사람·관전자 또는 AI 대체 자리가 있으면 방을 복구할 수 있다고 판정한다', () => {
  assert.equal(hasRecoverableRoomPlayer([{ isAI: false }]), true);
  assert.equal(hasRecoverableRoomPlayer([{ isAI: true, isSubstitutedByAI: true }]), true);
  assert.equal(hasRecoverableRoomPlayer([{ isSpectator: true }]), true);
  assert.equal(hasRecoverableRoomPlayer([{ isAI: true }]), false);
});

test('진행 상태와 진입 상태는 모두 인게임으로 판정한다', () => {
  assert.equal(isRoomExitInGame({ status: 'playing' }), true);
  assert.equal(isRoomExitInGame({ status: 'finished', startStatus: 'playing' }), true);
  assert.equal(isRoomExitInGame({ status: 'waiting', startStatus: 'entering' }), true);
  assert.equal(isRoomExitInGame({ status: 'waiting', startStatus: 'idle' }), false);
});

test('인게임 화면의 퇴장 정리는 로컬 포인터가 남아있어도 지연하지 않는다', () => {
  assert.equal(shouldDeferRoomExitCleanup(true, true), false);
  assert.equal(shouldDeferRoomExitCleanup(false, true), true);
  assert.equal(shouldDeferRoomExitCleanup(false, false), false);
});

test('인게임의 플레이어 시트는 퇴장 사유와 무관하게 AI로 대체한다', () => {
  assert.equal(shouldSubstituteRoomPlayerAsAi({ status: 'playing' }, { isAI: false }, true), true);
  assert.equal(shouldSubstituteRoomPlayerAsAi({ status: 'finished', startStatus: 'playing' }, { isAI: false }, true), true);
  assert.equal(shouldSubstituteRoomPlayerAsAi({ status: 'waiting' }, { isAI: false }, true), false);
  assert.equal(shouldSubstituteRoomPlayerAsAi({ status: 'playing' }, { isSpectator: true }, true), false);
  assert.equal(shouldSubstituteRoomPlayerAsAi({ status: 'playing' }, { isAI: false }, false), false);
});

test('마지막 인간이 AI로 대체되면 즉시 삭제하지 않고 삭제 유예를 시작한다', () => {
  assert.equal(shouldStartRoomDeletionGraceAfterAiSubstitution(aiSubstitution, [
    { isAI: true },
    { isAI: true, isSpectator: false },
  ]), true);
});

test('관전자나 다른 인간이 남아있으면 삭제 유예를 시작하지 않는다', () => {
  assert.equal(shouldStartRoomDeletionGraceAfterAiSubstitution(aiSubstitution, [
    { isAI: true },
    { isSpectator: true },
  ]), false);
  assert.equal(shouldStartRoomDeletionGraceAfterAiSubstitution(aiSubstitution, [
    { isAI: true },
    { isAI: false, isSpectator: false },
  ]), false);
});
