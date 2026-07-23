import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import {
  findCreatedRoomWithTimeout,
  requestRoomCreation,
  type CreatedRoom,
} from '../../src/app/flows/roomCreationControllerFlow.js';

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

test('방 생성 commit 후 모호한 오류가 반환돼도 같은 생성 요청 방으로 복구한다', async () => {
  const hostUser = { uid: 'host-1' } as User;
  const pendingRoomCreationRef = { current: null };
  let storedRoom: typeof createdRoom | null = null;
  let createdResult: { room: CreatedRoom; nextMessage?: string } | null = null;
  let roomNotice: { title: string; message: string } | null = null;
  const messages: string[] = [];

  await requestRoomCreation({
    title: createdRoom.title,
    nickname: '호스트',
    playMode: 'individual',
    maxPlayers: 2,
    itemMode: false,
    stackedRollMode: false,
    pieceCount: 4,
    currentUser: hostUser,
    userRef: { current: hostUser },
    pendingRoomCreationRef,
    rememberUser: () => undefined,
    onMaxPlayersChange: () => undefined,
    onMessage: (message) => messages.push(message),
    onLoadingMessage: () => undefined,
    onRoomNotice: (notice) => { roomNotice = notice; },
    onRoomCreated: async (room, _host, nextMessage) => {
      createdResult = { room, nextMessage };
    },
    runtime: {
      firebaseConfigured: true,
      signInAsGuest: async () => hostUser,
      makeRequestToken: () => request.createRequestId,
      createRoom: async (params) => {
        assert.equal(params.roomId, request.roomId);
        assert.equal(params.createRequestId, request.createRequestId);
        storedRoom = createdRoom;
        throw new Error('다른 방 생성 요청을 처리 중입니다. 잠시 뒤 다시 시도해주세요.');
      },
      getRoom: async (roomId) => roomId === request.roomId ? storedRoom : null,
    },
  });

  assert.deepEqual(createdResult, {
    room: createdRoom,
    nextMessage: '방 생성은 완료되어 대기실로 이동했습니다.',
  });
  assert.equal(roomNotice, null);
  assert.deepEqual(messages, ['']);
  assert.equal(pendingRoomCreationRef.current, null);
});
