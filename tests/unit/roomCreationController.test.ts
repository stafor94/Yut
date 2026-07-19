import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { RoomCreationTimeoutError } from '../../src/app/flows/roomCreationFlow.js';
import { requestRoomCreation } from '../../src/app/flows/roomCreationControllerFlow.js';


const user = (uid: string) => ({ uid }) as User;

const baseParams = (overrides: Partial<Parameters<typeof requestRoomCreation>[0]> = {}) => {
  const messages: string[] = [];
  const loadingMessages: string[] = [];
  const notices: Array<{ title: string; message: string } | null> = [];
  const created: Array<{ room: Record<string, unknown> & { id?: string }; hostUser: User; nextMessage?: string }> = [];
  const maxPlayers: number[] = [];
  const remembered: Array<User | null> = [];
  const pendingRoomCreationRef = { current: null } as Parameters<typeof requestRoomCreation>[0]['pendingRoomCreationRef'];
  const host = user('host-1');
  const defaultRuntime = {
    firebaseConfigured: true,
    signInAsGuest: async () => user('guest-1'),
    createRoom: async () => 'room-token-1',
    getRoom: async () => null,
    makeRequestToken: () => 'token-1',
  };
  return {
    params: {
      title: ' 테스트 방 ',
      nickname: '나',
      playMode: 'individual' as const,
      maxPlayers: 4,
      itemMode: true,
      stackedRollMode: false,
      pieceCount: 4 as const,
      currentUser: host,
      userRef: { current: null },
      pendingRoomCreationRef,
      rememberUser: (nextUser: User | null) => { remembered.push(nextUser); },
      onMaxPlayersChange: (nextMaxPlayers: number) => { maxPlayers.push(nextMaxPlayers); },
      onMessage: (message: string) => { messages.push(message); },
      onLoadingMessage: (message: string) => { loadingMessages.push(message); },
      onRoomNotice: (notice: { title: string; message: string } | null) => { notices.push(notice); },
      onRoomCreated: async (room: Record<string, unknown> & { id?: string }, hostUser: User, nextMessage?: string) => { created.push({ room, hostUser, nextMessage }); },
      ...overrides,
      runtime: { ...defaultRuntime, ...overrides.runtime },
    },
    messages,
    loadingMessages,
    notices,
    created,
    maxPlayers,
    remembered,
    pendingRoomCreationRef,
    host,
  };
};

test('정상 방 생성은 정규화한 제목과 현재 사용자로 createRoom을 호출하고 onRoomCreated를 한 번 호출한다', async () => {
  const createCalls: unknown[] = [];
  const context = baseParams({
    runtime: { firebaseConfigured: true, makeRequestToken: () => 'token-1', createRoom: async (params) => { createCalls.push(params); return 'room-token-1'; } },
  });
  await requestRoomCreation(context.params);
  assert.deepEqual(createCalls, [{ title: '테스트 방', hostId: 'host-1', nickname: '나', maxPlayers: 4, itemMode: true, stackedRollMode: false, playMode: 'individual', pieceCount: 4, roomId: 'room-token-1', createRequestId: 'token-1' }]);
  assert.equal(context.created.length, 1);
  assert.equal(context.created[0].hostUser.uid, 'host-1');
  assert.equal(context.pendingRoomCreationRef.current, null);
});

test('현재 사용자가 없으면 익명 인증 후 rememberUser와 createRoom을 순서대로 수행한다', async () => {
  const order: string[] = [];
  const guest = user('guest-1');
  const context = baseParams({
    currentUser: null,
    runtime: {
      firebaseConfigured: true,
      makeRequestToken: () => 'token-1',
      signInAsGuest: async () => { order.push('auth'); return guest; },
      createRoom: async (params) => { order.push(`create:${params.hostId}`); return 'room-token-1'; },
    },
    rememberUser: (nextUser) => { order.push(`remember:${nextUser?.uid ?? ''}`); },
  });
  await requestRoomCreation(context.params);
  assert.deepEqual(order, ['auth', 'remember:guest-1', 'create:guest-1']);
});

test('인증 timeout은 생성 실패 notice를 표시하고 pending 요청을 정리한다', async () => {
  const context = baseParams({
    currentUser: null,
    runtime: { firebaseConfigured: true, signInAsGuest: async () => { throw new RoomCreationTimeoutError('auth'); } },
  });
  await requestRoomCreation(context.params);
  assert.equal(context.messages[context.messages.length - 1], '입장 준비 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
  assert.equal(context.notices[context.notices.length - 1]?.title, '방 생성에 실패했습니다');
  assert.equal(context.pendingRoomCreationRef.current, null);
});

test('create timeout 후 요청과 host가 일치하는 방을 찾으면 복구 메시지와 함께 대기실 이동을 호출한다', async () => {
  const recovered = { id: 'room-token-1', title: '테스트 방', hostId: 'host-1', createRequestId: 'token-1', status: 'waiting' as const, itemMode: true, maxPlayers: 4, playMode: 'individual' as const, pieceCount: 4 as const };
  const context = baseParams({
    runtime: {
      firebaseConfigured: true,
      makeRequestToken: () => 'token-1',
      createRoom: async () => { throw new RoomCreationTimeoutError('create'); },
      getRoom: async () => recovered,
    },
  });
  await requestRoomCreation(context.params);
  assert.equal(context.created.length, 1);
  assert.equal(context.created[0].room.id, 'room-token-1');
  assert.equal(context.created[0].nextMessage, '방 생성은 완료되어 대기실로 이동했습니다.');
  assert.equal(context.pendingRoomCreationRef.current, null);
});

test('create timeout 후 방을 찾지 못하면 같은 요청 재시도 안내를 남기고 identity를 유지한다', async () => {
  const context = baseParams({ runtime: { firebaseConfigured: true, makeRequestToken: () => 'token-1', createRoom: async () => { throw new RoomCreationTimeoutError('create'); }, getRoom: async () => null } });
  await requestRoomCreation(context.params);
  assert.equal(context.messages[context.messages.length - 1], '방 만들기 응답이 지연되고 있습니다. 같은 요청으로 다시 확인할 수 있으니 잠시 뒤 방 만들기를 다시 눌러주세요.');
  assert.deepEqual(context.pendingRoomCreationRef.current, { roomId: 'room-token-1', createRequestId: 'token-1', title: '테스트 방' });
});

test('동일 제목 재시도는 request identity를 재사용하고 다른 제목은 새 identity를 만든다', async () => {
  const calls: unknown[] = [];
  const tokens = ['first', 'second'];
  const context = baseParams({ runtime: { firebaseConfigured: true, makeRequestToken: () => tokens.shift() ?? 'missing', createRoom: async (params) => { calls.push(params); return params.roomId; } } });
  context.pendingRoomCreationRef.current = { roomId: 'room-old', createRequestId: 'old', title: '테스트 방' };
  await requestRoomCreation(context.params);
  assert.equal((calls[0] as { roomId: string }).roomId, 'room-old');
  context.pendingRoomCreationRef.current = { roomId: 'room-old', createRequestId: 'old', title: '다른 방' };
  await requestRoomCreation(context.params);
  assert.equal((calls[1] as { roomId: string }).roomId, 'room-first');
});

test('닉네임 공백은 방 생성을 차단한다', async () => {
  let createCalled = false;
  const context = baseParams({ nickname: ' ', runtime: { firebaseConfigured: true, createRoom: async () => { createCalled = true; return 'room'; } } });
  await requestRoomCreation(context.params);
  assert.equal(createCalled, false);
  assert.equal(context.messages[context.messages.length - 1], '닉네임을 먼저 정해주세요.');
});

test('Firebase 미설정은 createRoom 없이 기존 오류 메시지를 표시하고 pending을 정리한다', async () => {
  let createCalled = false;
  const context = baseParams({ runtime: { firebaseConfigured: false, createRoom: async () => { createCalled = true; return 'room'; } } });
  await requestRoomCreation(context.params);
  assert.equal(createCalled, false);
  assert.equal(context.messages[context.messages.length - 1], 'Firebase 연결 정보가 없어 온라인 방을 만들 수 없습니다.');
  assert.equal(context.pendingRoomCreationRef.current, null);
});

test('일반 실패 후 pending 요청과 loading message를 정리한다', async () => {
  const context = baseParams({ runtime: { firebaseConfigured: true, createRoom: async () => { throw new Error('boom'); } } });
  await requestRoomCreation(context.params);
  assert.equal(context.messages[context.messages.length - 1], 'boom');
  assert.equal(context.loadingMessages[context.loadingMessages.length - 1], '');
  assert.equal(context.pendingRoomCreationRef.current, null);
});
