import assert from 'node:assert/strict';
import test from 'node:test';
import { getPresenceRestoreKey, shouldApplyPresenceRestoreResult } from '../../src/app/flows/presenceRecovery.js';

test('AI 대체 세대가 달라지면 복구 요청 key도 달라진다', () => {
  assert.notEqual(getPresenceRestoreKey('room', 'user', 1, 2), getPresenceRestoreKey('room', 'user', 1, 3));
});

test('같은 방과 사용자에서 더 새로운 presence epoch로 player 복구된 경우만 결과를 적용한다', () => {
  const base = {
    requestedRoomId: 'room-1', currentRoomId: 'room-1', requestedUserId: 'user-1', currentUserId: 'user-1',
    requestedPresenceEpoch: 3, restoredPresenceEpoch: 4, role: 'player' as const, screen: 'game',
  };
  assert.equal(shouldApplyPresenceRestoreResult(base), true);
  assert.equal(shouldApplyPresenceRestoreResult({ ...base, currentRoomId: 'room-2' }), false);
  assert.equal(shouldApplyPresenceRestoreResult({ ...base, currentUserId: 'user-2' }), false);
  assert.equal(shouldApplyPresenceRestoreResult({ ...base, restoredPresenceEpoch: 3 }), false);
  assert.equal(shouldApplyPresenceRestoreResult({ ...base, role: 'spectator' }), false);
});
