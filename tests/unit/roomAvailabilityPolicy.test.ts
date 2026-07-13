import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRoomAvailability } from '../../src/features/room/services/roomAvailabilityPolicy.js';

test('사람 플레이어가 한 명 이상 있는 정상 대기 방은 표시한다', () => {
  assert.deepEqual(classifyRoomAvailability(
    { status: 'waiting', maxPlayers: 4 },
    [{ id: 'human-a' }, { id: 'ai-a', isAI: true }, { id: 'spectator-a', isSpectator: true }],
    'viewer',
  ), {
    visible: true,
    reason: 'visible',
    currentPlayers: 1,
    playerIds: ['human-a'],
  });
});

test('다른 사용자의 AI 대체 자리만 남은 방은 들어갈 수 없으므로 숨긴다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2 },
    [{ id: 'departed-user', isAI: true, isSubstitutedByAI: true }],
    'viewer',
  );
  assert.equal(result.visible, false);
  assert.equal(result.reason, 'orphaned');
});

test('현재 사용자의 AI 대체 자리가 남은 진행 방은 복귀 대상으로 표시한다', () => {
  const result = classifyRoomAvailability(
    { status: 'playing', maxPlayers: 2 },
    [{ id: 'viewer', isAI: true, isSubstitutedByAI: true }],
    'viewer',
  );
  assert.equal(result.visible, true);
  assert.deepEqual(result.playerIds, ['viewer']);
});

test('가득 찬 대기 방은 기존 참가자가 아니면 숨긴다', () => {
  const players = [{ id: 'human-a' }, { id: 'human-b' }];
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 2 }, players, 'viewer').reason, 'full');
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 2 }, players, 'human-a').visible, true);
});

test('종료 상태 또는 잘못된 정원 정보의 방은 숨긴다', () => {
  assert.equal(classifyRoomAvailability({ status: 'finished', maxPlayers: 2 }, [{ id: 'human-a' }], 'viewer').reason, 'inactive');
  assert.equal(classifyRoomAvailability({ status: 'waiting', maxPlayers: 1 }, [{ id: 'human-a' }], 'viewer').reason, 'malformed');
});
