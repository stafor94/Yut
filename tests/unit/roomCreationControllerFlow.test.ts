import assert from 'node:assert/strict';
import test from 'node:test';
import { findCreatedRoomWithTimeout } from '../../src/app/flows/roomCreationControllerFlow.js';

const request = { roomId: 'room-request-1', createRequestId: 'request-1' };
const createdRoom = {
  id: request.roomId,
  title: 'QA 방',
  hostId: 'host-1',
  status: 'waiting' as const,
  maxPlayers: 2,
  itemMode: false,
  stackedRollMode: false,
  playMode: 'individual' as const,
  pieceCount: 4 as const,
  createRequestId: request.createRequestId,
};
const noWait = async () => undefined;

test('방 생성 timeout 복구는 일시 조회 오류와 null 이후 같은 생성 요청을 다시 찾아낸다', async () => {
  let calls = 0;
  const recoveredRoom = await findCreatedRoomWithTimeout(
    request,
    'host-1',
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary read failure');
      if (calls === 2) return null;
      return createdRoom;
    },
    { pollIntervalMs: 0, wait: noWait },
  );

  assert.equal(calls, 3);
  assert.deepEqual(recoveredRoom, createdRoom);
});

test('방 생성 timeout 복구는 다른 host 또는 request 방을 무시하고 정확한 방까지 재조회한다', async () => {
  const rooms = [
    { ...createdRoom, hostId: 'host-2' },
    { ...createdRoom, createRequestId: 'request-2' },
    createdRoom,
  ];
  let calls = 0;
  const recoveredRoom = await findCreatedRoomWithTimeout(
    request,
    'host-1',
    async () => rooms[calls++] ?? null,
    { pollIntervalMs: 0, wait: noWait },
  );

  assert.equal(calls, 3);
  assert.deepEqual(recoveredRoom, createdRoom);
});
