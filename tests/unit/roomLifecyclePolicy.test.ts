import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROOM_MAX_IDLE_MS,
  getRoomLastActivityMillis,
  hasHumanLifecyclePlayer,
  isRoomSummaryInactive,
  isReusableWaitingRoomSeat,
  shouldDeferOwnRoomRemoval,
  shouldDeleteRoomSnapshot,
} from '../../src/features/room/services/roomLifecyclePolicy.js';

test('2시간이 지난 방도 복귀 가능한 사람 플레이어가 있으면 삭제하지 않는다', () => {
  const now = 10 * ROOM_MAX_IDLE_MS;
  const room = { status: 'playing' as const, createdAt: now - ROOM_MAX_IDLE_MS * 2, lastActivityAt: now - ROOM_MAX_IDLE_MS * 2, currentPlayers: 1 };
  assert.equal(shouldDeleteRoomSnapshot(room, [{ id: 'human-a' }], now), false);
});

test('복귀 가능한 플레이어가 없는 방은 삭제 대상으로 판정한다', () => {
  const now = 10 * ROOM_MAX_IDLE_MS;
  const room = { status: 'playing' as const, createdAt: now - ROOM_MAX_IDLE_MS * 2, lastActivityAt: now - ROOM_MAX_IDLE_MS * 2, currentPlayers: 2 };
  assert.equal(shouldDeleteRoomSnapshot(room, [{ id: 'ai-a', isAI: true }], now), true);
});

test('현재 인원 요약이 0이어도 실제 players 검증 전에는 목록 후보에서 제거하지 않는다', () => {
  assert.equal(isRoomSummaryInactive({ status: 'waiting', createdAt: 100, currentPlayers: 0 }), false);
});

test('삭제 중이거나 시스템 잠금 문서는 방 목록 후보에서 제거한다', () => {
  assert.equal(isRoomSummaryInactive({ status: 'waiting', createdAt: 100, deletingAt: 200 }), true);
  assert.equal(isRoomSummaryInactive({ status: 'waiting', createdAt: 100, systemRoomType: 'creation_lock' }), true);
});

test('lastActivityAt이 있으면 createdAt보다 우선한다', () => {
  assert.equal(getRoomLastActivityMillis({ status: 'waiting', createdAt: 100, lastActivityAt: 200 }), 200);
});

test('방 전환 중인 본인의 현재 방 제거만 지연한다', () => {
  assert.equal(shouldDeferOwnRoomRemoval({ roomId: 'room-a', activeRoomId: 'room-a', currentUserId: 'user-a', playerId: 'user-a' }), true);
  assert.equal(shouldDeferOwnRoomRemoval({ roomId: 'room-a', activeRoomId: '', currentUserId: 'user-a', playerId: 'user-a' }), false);
  assert.equal(shouldDeferOwnRoomRemoval({ roomId: 'room-a', activeRoomId: 'room-a', currentUserId: 'host', playerId: 'kicked-user' }), false);
});

test('관전자와 AI를 제외한 사람 플레이어 존재 여부를 판정한다', () => {
  assert.equal(hasHumanLifecyclePlayer([{ id: 'spectator', isSpectator: true }, { id: 'ai', isAI: true }]), false);
  assert.equal(hasHumanLifecyclePlayer([{ id: 'human' }, { id: 'ai', isAI: true }]), true);
});

test('대기실에서는 삭제된 좌석과 disconnected 좌석만 재사용한다', () => {
  assert.equal(isReusableWaitingRoomSeat(null), true);
  assert.equal(isReusableWaitingRoomSeat({ status: 'disconnected', aiActive: false, isSubstitutedByAI: false }), true);
  assert.equal(isReusableWaitingRoomSeat({ status: 'human' }), false);
  assert.equal(isReusableWaitingRoomSeat({ status: 'ai_substitute', aiActive: true, isSubstitutedByAI: true }), false);
});
