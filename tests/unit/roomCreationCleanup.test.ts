import assert from 'node:assert/strict';
import test from 'node:test';
import { leavePlayerRoomsBeforeCreate } from '../../src/features/room/services/roomCreationCleanup.js';

test('방 생성 전 기존 모든 방을 상태 기반 퇴장으로 한 번씩 정리한다', async () => {
  const calls: Array<{ roomId: string; playerId: string }> = [];

  const leftRoomIds = await leavePlayerRoomsBeforeCreate({
    playerId: 'player-a',
    memberships: [
      { room: { id: 'room-a' } },
      { room: { id: 'room-b' } },
      { room: { id: 'room-a' } },
      { room: { id: '  ' } },
    ],
    leaveRoom: async (roomId, playerId) => {
      calls.push({ roomId, playerId });
    },
  });

  assert.deepEqual(leftRoomIds, ['room-a', 'room-b']);
  assert.deepEqual(calls, [
    { roomId: 'room-a', playerId: 'player-a' },
    { roomId: 'room-b', playerId: 'player-a' },
  ]);
});

test('기존 방 퇴장 실패를 전달하고 이후 방 처리를 중단한다', async () => {
  const attemptedRoomIds: string[] = [];

  await assert.rejects(
    leavePlayerRoomsBeforeCreate({
      playerId: 'player-a',
      memberships: [
        { room: { id: 'room-a' } },
        { room: { id: 'room-b' } },
        { room: { id: 'room-c' } },
      ],
      leaveRoom: async (roomId) => {
        attemptedRoomIds.push(roomId);
        if (roomId === 'room-b') throw new Error('leave failed');
      },
    }),
    /leave failed/,
  );

  assert.deepEqual(attemptedRoomIds, ['room-a', 'room-b']);
});
