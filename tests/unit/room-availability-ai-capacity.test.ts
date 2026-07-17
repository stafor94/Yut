import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRoomAvailability,
  isRoomCapacityFullError,
  ROOM_CAPACITY_FULL_ERROR_MESSAGE,
} from '../../src/features/room/services/roomAvailabilityPolicy';

const waitingRoom = { status: 'waiting' as const, maxPlayers: 4 };

test('일반 AI 좌석도 로비 현재 인원에 포함한다', () => {
  const result = classifyRoomAvailability(waitingRoom, [
    { id: 'host' },
    { id: 'slot-2', isAI: true },
    { id: 'spectator', isSpectator: true },
  ]);

  assert.equal(result.visible, true);
  assert.equal(result.currentPlayers, 2);
  assert.deepEqual(result.playerIds, ['host', 'slot-2']);
});

test('사람과 AI가 정원을 모두 차지하면 외부 사용자에게 full 상태로 분류한다', () => {
  const result = classifyRoomAvailability({ status: 'waiting', maxPlayers: 2 }, [
    { id: 'host' },
    { id: 'slot-2', isAI: true },
  ], 'guest');

  assert.equal(result.visible, false);
  assert.equal(result.reason, 'full');
  assert.equal(result.currentPlayers, 2);
});

test('정원이 찬 방의 기존 참가자는 자신의 방을 계속 확인할 수 있다', () => {
  const result = classifyRoomAvailability({ status: 'waiting', maxPlayers: 2 }, [
    { id: 'host' },
    { id: 'slot-2', isAI: true },
  ], 'host');

  assert.equal(result.visible, true);
  assert.equal(result.reason, 'visible');
  assert.equal(result.currentPlayers, 2);
});

test('정원 초과 오류만 팝업 대상으로 식별한다', () => {
  assert.equal(isRoomCapacityFullError(new Error(ROOM_CAPACITY_FULL_ERROR_MESSAGE)), true);
  assert.equal(isRoomCapacityFullError(new Error('존재하지 않는 방입니다.')), false);
  assert.equal(isRoomCapacityFullError('방이 가득 찼습니다.'), false);
});
