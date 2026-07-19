import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRoomHostClaimKey, resolveLocalRoomPlayerSnapshot, shouldIgnoreRoomPlayersSnapshot } from '../../src/app/flows/roomPlayersSubscriptionFlow.js';
interface TestRoomPlayer { id: string; nickname: string; ready: boolean; color: string; seatIndex: number; team: '청팀' | '홍팀'; isAI?: boolean; isSpectator?: boolean }

const player = (overrides: Partial<TestRoomPlayer> & { id: string }): TestRoomPlayer => ({
  nickname: overrides.nickname ?? overrides.id,
  ready: overrides.ready ?? false,
  color: overrides.color ?? 'red',
  seatIndex: overrides.seatIndex ?? 0,
  team: overrides.team ?? '청팀',
  ...overrides,
});

test('방이 없거나 stale 방 snapshot이면 무시한다', () => {
  assert.equal(shouldIgnoreRoomPlayersSnapshot('', ''), true);
  assert.equal(shouldIgnoreRoomPlayersSnapshot('room-a', 'room-b'), true);
  assert.equal(shouldIgnoreRoomPlayersSnapshot('room-a', 'room-a'), false);
});

test('현재 사용자 확인과 cleanup eligibility를 계산한다', () => {
    const result = resolveLocalRoomPlayerSnapshot([player({ id: 'user-a' })], 'user-a');
  assert.equal(result.localPresencePlayer?.id, 'user-a');
  assert.equal(result.hasCurrentUserInSnapshot, true);
  assert.equal(result.presenceCleanupEligible, true);
});

test('AI와 관전자는 cleanup eligibility에서 제외한다', () => {
  assert.equal(resolveLocalRoomPlayerSnapshot([player({ id: 'ai', isAI: true })], 'ai').presenceCleanupEligible, false);
  assert.equal(resolveLocalRoomPlayerSnapshot([player({ id: 'spectator', isSpectator: true })], 'spectator').hasCurrentUserInSnapshot, false);
});

test('방장 승계 중복 차단 key를 만든다', () => {
  assert.equal(makeRoomHostClaimKey('room-a', '', 'user-a'), 'room-a:missing:user-a');
  assert.equal(makeRoomHostClaimKey('room-a', 'old-host', 'user-a'), 'room-a:old-host:user-a');
});
