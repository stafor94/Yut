import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM_EMPTY_DELETE_GRACE_MS } from '../../src/features/room/services/roomLifecyclePolicy.js';
import { classifyRoomAvailability } from '../../src/features/room/services/roomAvailabilityPolicy.js';

const now = 1_000_000;

test('사람 플레이어가 한 명 이상 있는 정상 대기 방은 AI 좌석까지 인원에 포함해 표시한다', () => {
  assert.deepEqual(classifyRoomAvailability(
    { status: 'waiting', maxPlayers: 4 },
    [{ id: 'human-a', lastSeen: now }, { id: 'ai-a', isAI: true }, { id: 'spectator-a', isSpectator: true, lastSeen: now }],
    'viewer',
    now,
  ), {
    visible: true,
    reason: 'visible',
    currentPlayers: 2,
    playerIds: ['human-a'],
  });
});

test('관전자만 남아 있어도 활성 인간이므로 방을 표시한다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2 },
    [{ id: 'spectator-a', isSpectator: true, lastSeen: now }],
    'viewer',
    now,
  );
  assert.equal(result.visible, true);
  assert.equal(result.currentPlayers, 0);
});

test('아직 유예 시각이 기록되지 않은 AI 전용 방도 reconciliation 전에는 표시한다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2 },
    [{ id: 'departed-user', isAI: true, isSubstitutedByAI: true }],
    'viewer',
    now,
  );
  assert.equal(result.visible, true);
  assert.equal(result.reason, 'visible');
});

test('다른 사용자의 AI 대체 자리만 남은 방도 3분 유예 중에는 관전 입장을 위해 표시한다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2, emptySince: now - 1_000 },
    [{ id: 'departed-user', isAI: true, isSubstitutedByAI: true }],
    'viewer',
    now,
  );
  assert.equal(result.visible, true);
  assert.equal(result.reason, 'visible');
});

test('현재 사용자의 AI 대체 자리가 남은 진행 방은 복귀 대상으로 표시한다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2 },
    [{ id: 'viewer', isAI: true, isSubstitutedByAI: true }],
    'viewer',
    now,
  );
  assert.equal(result.visible, true);
  assert.deepEqual(result.playerIds, ['viewer']);
});

test('활성 인간이 없는 상태로 3분이 지난 방은 목록에서 숨긴다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2, emptySince: now - ROOM_EMPTY_DELETE_GRACE_MS },
    [{ id: 'departed-user', isAI: true, isSubstitutedByAI: true }],
    'viewer',
    now,
  );
  assert.equal(result.visible, false);
  assert.equal(result.reason, 'inactive');
});

test('정상 종료된 방도 활성 인간이 남아 있으면 대기실 복귀를 위해 표시한다', () => {
  const result = classifyRoomAvailability(
    { status: 'finished', maxPlayers: 2 },
    [{ id: 'human-a', lastSeen: now }],
    'viewer',
    now,
  );
  assert.equal(result.visible, true);
});

test('가득 찬 대기 방은 기존 참가자가 아니면 숨긴다', () => {
  const players = [{ id: 'human-a', lastSeen: now }, { id: 'human-b', lastSeen: now }];
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 2 }, players, 'viewer', now).reason, 'full');
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 2 }, players, 'human-a', now).visible, true);
});

test('삭제 중·시스템 상태 또는 잘못된 정원 정보의 방은 숨긴다', () => {
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 2, deletingAt: 1 }, [{ id: 'human-a', lastSeen: now }], 'viewer', now).reason, 'inactive');
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 2, systemRoomType: 'creation_lock' }, [{ id: 'human-a', lastSeen: now }], 'viewer', now).reason, 'inactive');
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 1 }, [{ id: 'human-a', lastSeen: now }], 'viewer', now).reason, 'malformed');
});
