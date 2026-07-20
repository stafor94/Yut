import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM_PRESENCE_STALE_MS } from '../../src/features/room/services/roomPresenceCleanupPolicy.js';
import {
  hasActiveHumanRoomSummary,
  isRoomCreationCandidate,
} from '../../src/features/room/services/roomCreationPolicy.js';

const now = 1_000_000;

test('최근 인간 heartbeat가 있는 방은 생성 제한 후보와 활성 인간 방으로 계산한다', () => {
  const room = {
    status: 'waiting' as const,
    createdAt: 1,
    lastHumanSeenAt: now - ROOM_PRESENCE_STALE_MS + 1,
    currentPlayers: 1,
  };

  assert.equal(isRoomCreationCandidate(room, now), true);
  assert.equal(hasActiveHumanRoomSummary(room, now), true);
});

test('명시적 빈 방 유예가 시작되면 삭제 전까지 후보에는 남지만 활성 인간 방으로 계산하지 않는다', () => {
  const room = {
    status: 'playing' as const,
    createdAt: 1,
    lastHumanSeenAt: now,
    emptySince: now - 1_000,
    currentPlayers: 2,
  };

  assert.equal(isRoomCreationCandidate(room, now), true);
  assert.equal(hasActiveHumanRoomSummary(room, now), false);
});

test('heartbeat가 stale이면 3분 삭제 유예 중에도 활성 인간 방 제한에서 제외한다', () => {
  const room = {
    status: 'finished' as const,
    createdAt: 1,
    lastHumanSeenAt: now - ROOM_PRESENCE_STALE_MS - 1,
    currentPlayers: 1,
  };

  assert.equal(isRoomCreationCandidate(room, now), true);
  assert.equal(hasActiveHumanRoomSummary(room, now), false);
});

test('삭제 유예가 만료된 방은 방 생성 후보에서 제외한다', () => {
  const room = {
    status: 'playing' as const,
    createdAt: 1,
    emptySince: now - 3 * 60 * 1_000,
    currentPlayers: 0,
  };

  assert.equal(isRoomCreationCandidate(room, now), false);
  assert.equal(hasActiveHumanRoomSummary(room, now), false);
});

test('기존 문서에 heartbeat 필드가 없으면 현재 인원 요약을 안전한 fallback으로 사용한다', () => {
  const room = {
    status: 'waiting' as const,
    createdAt: 1,
    currentPlayers: 1,
  };

  assert.equal(isRoomCreationCandidate(room, now), true);
  assert.equal(hasActiveHumanRoomSummary(room, now), true);
});
