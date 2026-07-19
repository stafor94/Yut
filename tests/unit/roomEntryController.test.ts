import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { leavePreviousOnlineRoomForEntry, openWaitingRoomForEntry, type RoomEntryControllerParams, type RoomSummary } from '../../src/app/flows/roomEntryControllerFlow.js';

const user = (uid: string) => ({ uid }) as User;
const room = (overrides: Partial<RoomSummary> = {}) => ({ id: 'room-1', title: '테스트 방', hostId: 'host-1', status: 'waiting', maxPlayers: 4, itemMode: true, stackedRollMode: false, playMode: 'individual', pieceCount: 4, ...overrides }) as RoomSummary;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
};

const baseParams = (overrides: Partial<RoomEntryControllerParams> = {}) => {
  const state = { activeRoomId: '', isRoomHost: false, activeRoomTitle: '', activeRoomHostId: '', playMode: '', maxPlayers: 0, itemMode: false, stackedRollMode: false, pieceCount: 0, seats: [] as unknown[], screen: '', message: '', loadingMessage: '' };
  const remembered: Array<User | null> = [];
  const storage = new Map<string, string>();
  const calls: string[] = [];
  const runtime = {
    firebaseConfigured: true,
    signInAsGuest: async () => { calls.push('auth'); return user('guest-1'); },
    getRoom: async (roomId: string) => { calls.push(`get:${roomId}`); return room({ id: roomId }); },
    removeRoomPlayer: async (roomId: string, userId: string) => { calls.push(`remove:${roomId}:${userId}`); },
    joinRoom: async (roomId: string, params: { userId: string }) => { calls.push(`join:${roomId}:${params.userId}`); return { role: 'player' as const, seatIndex: 2 }; },
    leaveDuplicatePlayerRooms: async (userId: string, roomId: string) => { calls.push(`dedupe:${userId}:${roomId}`); },
    isRoomInGame: (nextRoom: RoomSummary) => nextRoom.status === 'playing',
    setTimeout: (callback: () => void) => { callback(); return 1; },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => { storage.delete(key); } },
  };
  const params: RoomEntryControllerParams = {
    nickname: '나',
    currentUser: user('current-1'),
    userRef: { current: null },
    rememberUser: (nextUser) => { remembered.push(nextUser); },
    activeRoomIdRef: { current: '' },
    hostingRoomUserIdRef: { current: '' },
    leavingRoomRef: { current: true },
    onActiveRoomIdChange: (value) => { state.activeRoomId = value; },
    onRoomHostChange: (value) => { state.isRoomHost = value; },
    onActiveRoomTitleChange: (value) => { state.activeRoomTitle = value; },
    onRoomHostIdChange: (value) => { state.activeRoomHostId = value; },
    onPlayModeChange: (value) => { state.playMode = value; },
    onMaxPlayersChange: (value) => { state.maxPlayers = value; },
    onItemModeChange: (value) => { state.itemMode = value; },
    onStackedRollModeChange: (value) => { state.stackedRollMode = value; },
    onPieceCountChange: (value) => { state.pieceCount = value; },
    onSeatsChange: (value) => { state.seats = value; },
    onScreenChange: (value) => { state.screen = value; },
    onMessage: (value) => { state.message = value; },
    onLoadingMessage: (value) => { state.loadingMessage = value; },
    runtime,
    ...overrides,
  };
  return { params, state, remembered, storage, calls, runtime };
};

test('방장 입장은 joinRoom 없이 UID 좌석과 방장 상태를 적용하고 대기실로 이동한다', async () => {
  const context = baseParams();
  await openWaitingRoomForEntry({ ...context.params, room: room(), nextMessage: '입장', asHost: true, hostUserOverride: user('host-1') });
  assert.equal(context.calls.some((call) => call.startsWith('join:')), false);
  assert.equal(context.state.isRoomHost, true);
  assert.equal(context.state.screen, 'waitingRoom');
  assert.equal((context.state.seats[0] as { id: string }).id, 'host-1');
  assert.equal(context.params.hostingRoomUserIdRef.current, 'host-1');
});

test('일반 참가자 입장은 이전 방 정리 후 joinRoom seat index를 반영하고 대기실로 이동한다', async () => {
  const context = baseParams();
  context.params.activeRoomIdRef.current = 'old-room';
  await openWaitingRoomForEntry({ ...context.params, room: room() });
  assert.deepEqual(context.calls.slice(0, 3), ['get:old-room', 'remove:old-room:current-1', 'join:room-1:current-1']);
  assert.equal((context.state.seats[2] as { id: string }).id, 'current-1');
  assert.equal(context.state.screen, 'waitingRoom');
});

test('진행 중인 방 일반 입장은 game 화면으로 이동한다', async () => {
  const context = baseParams();
  await openWaitingRoomForEntry({ ...context.params, room: room({ status: 'playing' }) });
  assert.equal(context.state.screen, 'game');
});

test('인증 사용자가 없으면 signInAsGuest, rememberUser, joinRoom 순서로 수행한다', async () => {
  const order: string[] = [];
  const context = baseParams({ currentUser: null, rememberUser: (nextUser) => { order.push(`remember:${nextUser?.uid ?? ''}`); } });
  context.params.runtime.signInAsGuest = async () => { order.push('auth'); return user('guest-1'); };
  context.params.runtime.joinRoom = async (_roomId, params) => { order.push(`join:${params.userId}`); return { role: 'player', seatIndex: 1 }; };
  await openWaitingRoomForEntry({ ...context.params, room: room() });
  assert.deepEqual(order, ['auth', 'remember:guest-1', 'join:guest-1']);
});

test('인증 timeout은 기존 오류 메시지로 입장 실패 상태를 적용한다', async () => {
  const context = baseParams({ currentUser: null });
  context.params.runtime.signInAsGuest = () => new Promise<User | null>(() => undefined);
  context.params.runtime.setTimeout = (callback) => { callback(); return 1; };
  await openWaitingRoomForEntry({ ...context.params, room: room() });
  assert.equal(context.state.screen, 'lobby');
  assert.equal(context.state.loadingMessage, '');
  assert.equal(context.state.message, 'JOIN_ROOM_TIMEOUT');
  assert.equal(context.state.activeRoomId, '');
  assert.equal(context.state.isRoomHost, false);
});

test('이전 방 정리는 다른 방 플레이어를 제거하고 같은 방은 제거하지 않는다', async () => {
  const context = baseParams();
  context.params.activeRoomIdRef.current = 'old-room';
  await leavePreviousOnlineRoomForEntry({ ...context.params, nextRoomId: 'new-room' });
  assert.deepEqual(context.calls, ['get:old-room', 'remove:old-room:current-1']);
  context.calls.length = 0;
  await leavePreviousOnlineRoomForEntry({ ...context.params, nextRoomId: 'old-room' });
  assert.deepEqual(context.calls, []);
});

test('이전 방 정리 실패는 새 방 입장을 막지 않는다', async () => {
  const context = baseParams();
  context.params.activeRoomIdRef.current = 'old-room';
  context.params.runtime.removeRoomPlayer = async () => { throw new Error('cleanup failed'); };
  await openWaitingRoomForEntry({ ...context.params, room: room() });
  assert.equal(context.state.activeRoomId, 'room-1');
  assert.equal(context.state.screen, 'waitingRoom');
});

test('방장은 이전 방 정리를 기다리지 않고 일반 참가자는 정리 완료 후 joinRoom을 호출한다', async () => {
  const hostCleanup = deferred<void>();
  const hostContext = baseParams();
  hostContext.params.activeRoomIdRef.current = 'old-room';
  hostContext.params.runtime.removeRoomPlayer = async () => { await hostCleanup.promise; };
  await openWaitingRoomForEntry({ ...hostContext.params, room: room(), asHost: true, hostUserOverride: user('host-1') });
  assert.equal(hostContext.state.activeRoomId, 'room-1');
  hostCleanup.resolve();

  const joinOrder: string[] = [];
  const joinCleanup = deferred<void>();
  const participantContext = baseParams();
  participantContext.params.activeRoomIdRef.current = 'old-room';
  participantContext.params.runtime.removeRoomPlayer = async () => { joinOrder.push('cleanup:start'); await joinCleanup.promise; joinOrder.push('cleanup:end'); };
  participantContext.params.runtime.joinRoom = async () => { joinOrder.push('join'); return { role: 'player', seatIndex: 1 }; };
  const entering = openWaitingRoomForEntry({ ...participantContext.params, room: room() });
  await Promise.resolve();
  assert.deepEqual(joinOrder, ['cleanup:start']);
  joinCleanup.resolve();
  await entering;
  assert.deepEqual(joinOrder, ['cleanup:start', 'cleanup:end', 'join']);
});

test('중복 참여 방 정리는 입장 완료 후 호출되고 실패해도 입장 상태를 유지한다', async () => {
  const context = baseParams();
  context.params.runtime.leaveDuplicatePlayerRooms = async () => { throw new Error('dedupe failed'); };
  await openWaitingRoomForEntry({ ...context.params, room: room() });
  assert.equal(context.state.activeRoomId, 'room-1');
  assert.equal(context.state.screen, 'waitingRoom');
});

test('입장 실패는 active room 관련 상태를 초기화하고 기존 오류 메시지를 유지한다', async () => {
  const context = baseParams();
  context.params.hostingRoomUserIdRef.current = 'host-1';
  context.params.runtime.joinRoom = async () => { throw new Error('입장할 수 없습니다.'); };
  await openWaitingRoomForEntry({ ...context.params, room: room() });
  assert.equal(context.params.hostingRoomUserIdRef.current, '');
  assert.equal(context.state.activeRoomId, '');
  assert.equal(context.state.isRoomHost, false);
  assert.equal(context.state.activeRoomTitle, '');
  assert.equal(context.state.activeRoomHostId, '');
  assert.equal(context.state.screen, 'lobby');
  assert.equal(context.state.loadingMessage, '');
  assert.equal(context.state.message, '입장할 수 없습니다.');
});

test('openWaitingRoomForEntry는 같은 방 재입장 시 이전 방 조회와 제거를 수행하지 않는다', async () => {
  const context = baseParams();
  context.params.activeRoomIdRef.current = 'room-1';
  await openWaitingRoomForEntry({ ...context.params, room: room({ id: 'room-1' }) });
  assert.equal(context.calls.includes('get:room-1'), false);
  assert.equal(context.calls.some((call) => call.startsWith('remove:room-1:')), false);
  assert.equal(context.state.activeRoomId, 'room-1');
});

test('openWaitingRoomForEntry는 다른 방 이동 시 이전 방 정리에 실제 새 room id를 전달한다', async () => {
  const context = baseParams();
  context.params.activeRoomIdRef.current = 'old-room';
  await openWaitingRoomForEntry({ ...context.params, room: room({ id: 'new-room' }) });
  assert.deepEqual(context.calls.slice(0, 3), ['get:old-room', 'remove:old-room:current-1', 'join:new-room:current-1']);
  assert.equal(context.state.activeRoomId, 'new-room');
  assert.equal(context.storage.has('activeRoomId'), false);
});

test('방장 이전 방 cleanup이 늦게 완료되어도 새 active room을 빈 값으로 초기화하지 않는다', async () => {
  const cleanup = deferred<void>();
  const context = baseParams();
  context.params.activeRoomIdRef.current = 'old-room';
  context.params.runtime.removeRoomPlayer = async () => { await cleanup.promise; };
  await openWaitingRoomForEntry({ ...context.params, room: room({ id: 'new-room' }), asHost: true, hostUserOverride: user('host-1') });
  assert.equal(context.state.activeRoomId, 'new-room');
  context.params.activeRoomIdRef.current = 'new-room';
  cleanup.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(context.state.activeRoomId, 'new-room');
});
