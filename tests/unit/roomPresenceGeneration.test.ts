import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCurrentPresenceRestoreResult,
  makePresenceRestoreKey,
  nextPresenceGeneration,
  normalizePresenceGeneration,
} from '../../src/features/room/services/roomPresenceGeneration.js';

test('presence generation은 잘못된 값을 0으로 정규화하고 최신 값보다 증가한다', () => {
  assert.equal(normalizePresenceGeneration(-1), 0);
  assert.equal(normalizePresenceGeneration('3'), 3);
  assert.equal(nextPresenceGeneration(2, 5), 6);
});

test('복구 key는 room, user, seat, generation을 모두 포함한다', () => {
  assert.equal(makePresenceRestoreKey('room-1', 'user-1', 2, 4), 'room-1:user-1:2:4');
});

test('오래된 복구 응답은 방·사용자·요청 버전·세대 중 하나라도 바뀌면 무효다', () => {
  const base = {
    requestVersion: 3,
    currentRequestVersion: 3,
    requestRoomId: 'room-1',
    currentRoomId: 'room-1',
    requestUserId: 'user-1',
    currentUserId: 'user-1',
    observedGeneration: 5,
    restoredGeneration: 6,
  };
  assert.equal(isCurrentPresenceRestoreResult(base), true);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, currentRequestVersion: 4 }), false);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, currentRoomId: 'room-2' }), false);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, currentUserId: 'user-2' }), false);
  assert.equal(isCurrentPresenceRestoreResult({ ...base, restoredGeneration: 5 }), false);
});
