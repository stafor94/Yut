import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROOM_EMPTY_DELETE_GRACE_MS,
  ROOM_MAX_IDLE_MS,
  countConnectedHumanRoomSeats,
  countConnectedHumanRoomSeatsAfterClaim,
  getRoomDeletionDeadlineMillis,
  getRoomDerivedEmptySinceMillis,
  getRoomLastActivityMillis,
  hasActiveHumanLifecyclePlayer,
  hasActiveRoomPlayerForUser,
  hasCreationBlockingHumanPlayer,
  hasHumanLifecyclePlayer,
  hasResumablePlayerForUser,
  isConnectedHumanRoomSeat,
  isRoomDeletionExpired,
  isRoomDeletionGraceActive,
  isRoomSummaryInactive,
  isReusableWaitingRoomSeat,
  shouldDeferOwnRoomRemoval,
  shouldDeleteRoomSnapshot,
  shouldRestoreDeferredRoomPointer,
  shouldStartRoomDeletionGrace,
} from '../../src/features/room/services/roomLifecyclePolicy.js';

test('2시간이 지난 방도 heartbeat가 유효한 사람 플레이어가 있으면 삭제하지 않는다', () => {
  const now = 10 * ROOM_MAX_IDLE_MS;
  const room = { status: 'playing' as const, createdAt: now - ROOM_MAX_IDLE_MS * 2, lastActivityAt: now - ROOM_MAX_IDLE_MS * 2, currentPlayers: 1 };
  assert.equal(shouldDeleteRoomSnapshot(room, [{ id: 'human-a', lastSeen: now }], now), false);
});

test('활성 인간이 없으면 삭제 유예를 시작하고 3분 전에는 삭제하지 않는다', () => {
  const now = 1_000_000;
  const room = { status: 'playing' as const, createdAt: 1, lastActivityAt: now };
  const players = [{ id: 'ai-a', isAI: true }];
  assert.equal(shouldStartRoomDeletionGrace(room, players, now), true);

  const graceRoom = { ...room, emptySince: now };
  assert.equal(getRoomDeletionDeadlineMillis(graceRoom), now + ROOM_EMPTY_DELETE_GRACE_MS);
  assert.equal(isRoomDeletionGraceActive(graceRoom, now + ROOM_EMPTY_DELETE_GRACE_MS - 1), true);
  assert.equal(shouldDeleteRoomSnapshot(graceRoom, players, now + ROOM_EMPTY_DELETE_GRACE_MS - 1), false);
});

test('마지막 heartbeat가 끊긴 방은 45초 stale 시점부터 3분 유예를 계산한다', () => {
  const lastHumanSeenAt = 1_000_000;
  const derivedEmptySince = lastHumanSeenAt + 45_000;
  const room = { status: 'playing' as const, createdAt: 1, lastHumanSeenAt };
  assert.equal(getRoomDerivedEmptySinceMillis(room), derivedEmptySince);
  assert.equal(getRoomDeletionDeadlineMillis(room), derivedEmptySince + ROOM_EMPTY_DELETE_GRACE_MS);
  assert.equal(shouldDeleteRoomSnapshot(room, [{ id: 'ai', isAI: true }], derivedEmptySince + ROOM_EMPTY_DELETE_GRACE_MS - 1), false);
  assert.equal(shouldDeleteRoomSnapshot(room, [{ id: 'ai', isAI: true }], derivedEmptySince + ROOM_EMPTY_DELETE_GRACE_MS), true);
});

test('활성 인간이 없는 상태로 3분이 지나면 삭제 대상으로 판정한다', () => {
  const now = 1_000_000;
  const room = { status: 'finished' as const, createdAt: 1, emptySince: now - ROOM_EMPTY_DELETE_GRACE_MS };
  const players = [{ id: 'ai-a', isAI: true, isSubstitutedByAI: true }];
  assert.equal(isRoomDeletionExpired(room, now), true);
  assert.equal(shouldDeleteRoomSnapshot(room, players, now), true);
});

test('관전자도 heartbeat가 유효하면 활성 인간으로 계산하고 삭제 유예를 취소한다', () => {
  const now = 100_000;
  const spectator = { id: 'spectator', isSpectator: true, lastSeen: now - 1_000 };
  const room = { status: 'playing' as const, createdAt: 1, emptySince: now - ROOM_EMPTY_DELETE_GRACE_MS * 2 };
  assert.equal(hasActiveHumanLifecyclePlayer([spectator], now), true);
  assert.equal(shouldStartRoomDeletionGrace({ ...room, emptySince: null }, [spectator], now), false);
  assert.equal(shouldDeleteRoomSnapshot(room, [spectator], now), false);
});

test('heartbeat가 만료된 관전자만 남으면 활성 인간이 아니므로 삭제 유예를 시작한다', () => {
  const now = 100_000;
  const staleSpectator = { id: 'spectator', isSpectator: true, lastSeen: 1 };
  assert.equal(hasActiveHumanLifecyclePlayer([staleSpectator], now), false);
  assert.equal(shouldStartRoomDeletionGrace({ status: 'playing', createdAt: 1 }, [staleSpectator], now), true);
});

test('정상 종료된 방도 활성 인간이 남아 있으면 목록과 수명주기에서 유지한다', () => {
  const now = 100_000;
  const room = { status: 'finished' as const, createdAt: 1 };
  const players = [{ id: 'human', lastSeen: now }];
  assert.equal(isRoomSummaryInactive(room), false);
  assert.equal(shouldDeleteRoomSnapshot(room, players, now), false);
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

test('관전자도 AI가 아닌 인간 플레이어로 판정한다', () => {
  assert.equal(hasHumanLifecyclePlayer([{ id: 'spectator', isSpectator: true }, { id: 'ai', isAI: true }]), true);
  assert.equal(hasHumanLifecyclePlayer([{ id: 'ai', isAI: true }]), false);
});

test('대기실에서는 삭제된 좌석과 disconnected 좌석만 재사용한다', () => {
  assert.equal(isReusableWaitingRoomSeat(null), true);
  assert.equal(isReusableWaitingRoomSeat({ status: 'disconnected', aiActive: false, isSubstitutedByAI: false }), true);
  assert.equal(isReusableWaitingRoomSeat({ status: 'human' }), false);
  assert.equal(isReusableWaitingRoomSeat({ status: 'ai_substitute', aiActive: true, isSubstitutedByAI: true }), false);
});

test('연결 인원은 실제 사람 좌석만 세고 AI 대체 좌석 복귀 시 한 명만 증가한다', () => {
  const seats = [
    { status: 'ai_substitute' as const, aiActive: true, isSubstitutedByAI: true },
    { status: 'human' as const, aiActive: true, isSubstitutedByAI: false },
    { status: 'human' as const, aiActive: false, isSubstitutedByAI: false },
    null,
  ];
  assert.equal(isConnectedHumanRoomSeat(seats[0]), false);
  assert.equal(isConnectedHumanRoomSeat(seats[1]), false);
  assert.equal(isConnectedHumanRoomSeat(seats[2]), true);
  assert.equal(countConnectedHumanRoomSeats(seats), 1);
  assert.equal(countConnectedHumanRoomSeatsAfterClaim(seats, 0), 2);
  assert.equal(countConnectedHumanRoomSeatsAfterClaim(seats, 2), 1);
});

test('AI 대체 방은 복귀 대상으로 유지하되 새 방 생성 차단 대상에서는 제외한다', () => {
  const otherAiRoomPlayers = [{ id: 'other', isAI: true, isSubstitutedByAI: true }];
  const ownAiRoomPlayers = [{ id: 'viewer', isAI: true, isSubstitutedByAI: true }];
  const ownActivePlayers = [{ id: 'viewer', isAI: false }];
  assert.equal(hasCreationBlockingHumanPlayer(otherAiRoomPlayers), false);
  assert.equal(hasResumablePlayerForUser(otherAiRoomPlayers, 'viewer'), false);
  assert.equal(hasResumablePlayerForUser(ownAiRoomPlayers, 'viewer'), true);
  assert.equal(hasActiveRoomPlayerForUser(ownAiRoomPlayers, 'viewer'), false);
  assert.equal(hasActiveRoomPlayerForUser(ownActivePlayers, 'viewer'), true);
  assert.equal(hasCreationBlockingHumanPlayer([{ id: 'spectator', isSpectator: true }]), true);
});

test('대상 방 입장이 실패하고 활성 방 포인터가 비어 있으면 기존 방 포인터를 복원한다', () => {
  assert.equal(shouldRestoreDeferredRoomPointer({ hasOtherMembership: false, activeRoomId: '' }), true);
  assert.equal(shouldRestoreDeferredRoomPointer({ hasOtherMembership: true, activeRoomId: '' }), false);
  assert.equal(shouldRestoreDeferredRoomPointer({ hasOtherMembership: false, activeRoomId: 'room-b' }), false);
});
