import assert from 'node:assert/strict';
import test from 'node:test';
import { getPresenceRecoveryKey, isPresenceRestoreAttemptCurrent } from '../../src/app/flows/presenceRecovery.js';

test('AI 대체 세대가 달라지면 재접속 복구 key도 달라진다', () => {
  assert.notEqual(
    getPresenceRecoveryKey('room-1', 'user-1', 1, 3),
    getPresenceRecoveryKey('room-1', 'user-1', 1, 4),
  );
});

test('같은 방, 사용자, 복구 세대와 최신 attempt만 성공 응답을 적용한다', () => {
  const base = {
    attempt: 2,
    currentAttempt: 2,
    restoreKey: 'room-1:user-1:1:4',
    currentRestoreKey: 'room-1:user-1:1:4',
    roomId: 'room-1',
    currentRoomId: 'room-1',
    userId: 'user-1',
    currentUserId: 'user-1',
  };
  assert.equal(isPresenceRestoreAttemptCurrent(base), true);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentAttempt: 3 }), false);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentRoomId: 'room-2' }), false);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentUserId: 'user-2' }), false);
  assert.equal(isPresenceRestoreAttemptCurrent({ ...base, currentRestoreKey: 'room-1:user-1:1:5' }), false);
});
