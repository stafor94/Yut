import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('관전자는 좌석 플레이어는 아니지만 인간 presence cleanup 주체가 된다', () => {
  const result = resolveLocalRoomPlayerSnapshot([player({ id: 'spectator', isSpectator: true })], 'spectator');
  assert.equal(result.hasCurrentUserInSnapshot, false);
  assert.equal(result.presenceCleanupEligible, true);
  assert.equal(resolveLocalRoomPlayerSnapshot([player({ id: 'ai', isAI: true })], 'ai').presenceCleanupEligible, false);
});

test('방장 승계 중복 차단 key를 만든다', () => {
  assert.equal(makeRoomHostClaimKey('room-a', '', 'user-a'), 'room-a:missing:user-a');
  assert.equal(makeRoomHostClaimKey('room-a', 'old-host', 'user-a'), 'room-a:old-host:user-a');
});

test('room player 구독은 렌더마다 바뀌는 콜백을 ref로 읽고 effect 의존성에서 제외한다', () => {
  const source = readFileSync('src/app/controllers/useRoomPlayersSubscription.ts', 'utf8');

  assert.match(source, /const addLogsRef = useRef\(addLogs\);/);
  assert.match(source, /const handlePresencePlayerSnapshotRef = useRef\(handlePresencePlayerSnapshot\);/);
  assert.match(source, /handlePresencePlayerSnapshotRef\.current\(localPresencePlayer\);/);
  assert.match(source, /addLogsRef\.current\(systemLogTexts\);/);
  assert.doesNotMatch(source, /\}, \[[^\]]*\baddLogs\b[^\]]*\]\);/s);
  assert.doesNotMatch(source, /\}, \[[^\]]*\bhandlePresencePlayerSnapshot\b[^\]]*\]\);/s);
});
