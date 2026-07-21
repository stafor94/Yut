import assert from 'node:assert/strict';
import test from 'node:test';
import { leavePlayerRoomsBeforeCreate } from '../../src/features/room/services/roomCreationCleanup.js';

test('방 생성 전 기존 모든 방을 중복 없이 병렬 정리한다', async () => {
  const calls: Array<{ roomId: string; playerId: string }> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const pending = leavePlayerRoomsBeforeCreate({
    playerId: 'player-a',
    memberships: [
      { room: { id: 'room-a' } },
      { room: { id: 'room-b' } },
      { room: { id: 'room-a' } },
      { room: { id: '  ' } },
    ],
    leaveRoom: async (roomId, playerId) => {
      calls.push({ roomId, playerId });
      await gate;
    },
  });

  await Promise.resolve();
  assert.deepEqual(calls, [
    { roomId: 'room-a', playerId: 'player-a' },
    { roomId: 'room-b', playerId: 'player-a' },
  ]);

  release();
  assert.deepEqual(await pending, ['room-a', 'room-b']);
});

test('AI가 대신 진행 중인 복귀 가능 방은 새 방 생성 전 정리에서 제외한다', async () => {
  const attemptedRoomIds: string[] = [];
  const cleanedRoomIds = await leavePlayerRoomsBeforeCreate({
    playerId: 'player-a',
    memberships: [
      { room: { id: 'waiting-room' }, player: { isAI: false } },
      { room: { id: 'resume-room' }, player: { isAI: true, isSubstitutedByAI: true } },
      { room: { id: ' waiting-room ' }, player: { isAI: false } },
    ],
    leaveRoom: async (roomId) => {
      attemptedRoomIds.push(roomId);
    },
  });

  assert.deepEqual(cleanedRoomIds, ['waiting-room']);
  assert.deepEqual(attemptedRoomIds, ['waiting-room']);
});

test('기존 방 하나의 퇴장이 실패해도 모든 독립 퇴장을 시작한 뒤 오류를 전달한다', async () => {
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

  assert.deepEqual(attemptedRoomIds, ['room-a', 'room-b', 'room-c']);
});
