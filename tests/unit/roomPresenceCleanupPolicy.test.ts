import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideRoomPresenceCleanupLease,
  getRoomPresenceCleanupAction,
  isEligiblePresenceCleanupCandidate,
  isStaleHumanPresencePlayer,
} from '../../src/features/room/services/roomPresenceCleanupPolicy.js';

test('한 방의 cleanup lease는 한 소유자만 유지하고 만료 뒤 다른 사용자가 인계한다', () => {
  const now = 100_000;
  const acquired = decideRoomPresenceCleanupLease({ status: 'playing' }, 'player-a', now, 25_000);
  assert.deepEqual(acquired, { status: 'acquire', ownerId: 'player-a', expiresAt: 125_000, version: 1 });

  const held = decideRoomPresenceCleanupLease({
    status: 'playing',
    presenceCleanupLeaseOwnerId: acquired.ownerId,
    presenceCleanupLeaseExpiresAt: acquired.expiresAt,
    presenceCleanupLeaseVersion: acquired.version,
  }, 'player-b', now + 10_000, 25_000);
  assert.equal(held.status, 'held');
  assert.equal(held.ownerId, 'player-a');

  const renewed = decideRoomPresenceCleanupLease({
    status: 'playing',
    presenceCleanupLeaseOwnerId: acquired.ownerId,
    presenceCleanupLeaseExpiresAt: acquired.expiresAt,
    presenceCleanupLeaseVersion: acquired.version,
  }, 'player-a', now + 10_000, 25_000);
  assert.deepEqual(renewed, { status: 'renew', ownerId: 'player-a', expiresAt: 135_000, version: 1 });

  const takenOver = decideRoomPresenceCleanupLease({
    status: 'playing',
    presenceCleanupLeaseOwnerId: acquired.ownerId,
    presenceCleanupLeaseExpiresAt: acquired.expiresAt,
    presenceCleanupLeaseVersion: acquired.version,
  }, 'player-b', now + 25_001, 25_000);
  assert.deepEqual(takenOver, { status: 'acquire', ownerId: 'player-b', expiresAt: 150_001, version: 2 });
});

test('정상 종료된 방도 대기실 복귀 전까지 cleanup lease를 유지할 수 있다', () => {
  assert.equal(decideRoomPresenceCleanupLease({ status: 'finished' }, 'player-a', 1000).status, 'acquire');
  assert.equal(decideRoomPresenceCleanupLease({ status: 'waiting' }, '', 1000).status, 'inactive');
});

test('관전자는 인간으로서 cleanup 주체와 stale 대상에 포함하고 AI는 제외한다', () => {
  assert.equal(isEligiblePresenceCleanupCandidate({ id: 'human' }), true);
  assert.equal(isEligiblePresenceCleanupCandidate({ id: 'spectator', isSpectator: true }), true);
  assert.equal(isEligiblePresenceCleanupCandidate({ id: 'ai', isAI: true }), false);

  const now = 100_000;
  assert.equal(isStaleHumanPresencePlayer({ id: 'spectator', isSpectator: true, lastSeen: 1 }, now, 45_000), true);
  assert.equal(isStaleHumanPresencePlayer({ id: 'ai', isAI: true, lastSeen: 1 }, now, 45_000), false);
});

test('fresh heartbeat는 유지하고 stale human만 정리 대상으로 판정한다', () => {
  const now = 100_000;
  assert.equal(isStaleHumanPresencePlayer({ id: 'fresh', lastSeen: 60_000 }, now, 45_000), false);
  assert.equal(isStaleHumanPresencePlayer({ id: 'stale', lastSeen: 54_999 }, now, 45_000), true);
  assert.equal(isStaleHumanPresencePlayer({ id: 'missing' }, now, 45_000), true);
});

test('게임 중 stale 플레이어는 AI 대체하고 대기실 stale 플레이어는 제거한다', () => {
  const now = 100_000;
  const player = { id: 'player-a', lastSeen: 1, seatIndex: 1 };
  assert.equal(getRoomPresenceCleanupAction({ status: 'playing' }, player, now, 45_000), 'substitute_ai');
  assert.equal(getRoomPresenceCleanupAction({ status: 'waiting' }, player, now, 45_000), 'remove');
  assert.equal(getRoomPresenceCleanupAction({ status: 'waiting', startStatus: 'entering' }, player, now, 45_000), 'substitute_ai');
});

test('관전자는 가상 seatIndex가 있어도 항상 제거하고 AI 대체 좌석을 만들지 않는다', () => {
  const action = getRoomPresenceCleanupAction({ status: 'playing' }, { id: 'spectator', isSpectator: true, lastSeen: 1, seatIndex: 123 }, 100_000, 45_000);
  assert.equal(action, 'remove');
});
