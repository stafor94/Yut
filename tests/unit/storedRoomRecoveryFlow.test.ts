import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { STORAGE_KEYS } from '../../src/app/preferences/localPreferences.js';
import { getStoredRoomRecoveryTarget, recoverStoredRoom, type StoredRoomRecoveryFlowParams } from '../../src/app/flows/storedRoomRecoveryFlow.js';
import type { RoomSummary } from '../../src/app/flows/roomEntryControllerFlow.js';

const user = (uid: string) => ({ uid }) as User;
const room = (overrides: Partial<RoomSummary> = {}) => ({ id: 'stored-room', title: '저장 방', hostId: 'host-1', status: 'waiting', maxPlayers: 4, itemMode: true, stackedRollMode: false, playMode: 'individual', pieceCount: 4, ...overrides }) as RoomSummary;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
};

const baseParams = (overrides: Partial<StoredRoomRecoveryFlowParams> = {}) => {
  const state = { activeRoomId: '', isRoomHost: false, activeRoomTitle: 'old-title', activeRoomHostId: 'old-host', playMode: '', maxPlayers: 0, itemMode: false, stackedRollMode: false, pieceCount: 0, seats: [] as unknown[], screen: '', message: '', loadingMessage: '' };
  const storage = new Map<string, string>([[STORAGE_KEYS.activeRoomId, 'stored-room'], [STORAGE_KEYS.isRoomHost, 'true']]);
  const calls: string[] = [];
  const runtime = {
    getRoom: async (roomId: string) => { calls.push(`get:${roomId}`); return room({ id: roomId }); },
    joinRoom: async (roomId: string, params: { userId: string }) => { calls.push(`join:${roomId}:${params.userId}`); return { role: 'player' as const, seatIndex: 2 }; },
    isRoomInGame: (nextRoom: RoomSummary) => nextRoom.status === 'playing',
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => { calls.push(`removeStorage:${key}`); storage.delete(key); } },
    getCurrentActiveRoomId: () => state.activeRoomId,
  };
  const params: StoredRoomRecoveryFlowParams = {
    currentUser: user('current-1'),
    nickname: '나',
    hostingRoomUserIdRef: { current: 'host-old' },
    storedRoomId: 'stored-room',
    isCancelled: () => false,
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
  return { params, state, storage, calls, runtime };
};

test('저장된 방 ID가 없으면 복구를 시작하지 않는다', () => {
  const storage = { getItem: () => null };
  assert.equal(getStoredRoomRecoveryTarget({ currentUser: user('current-1'), activeRoomId: '', localStorage: storage }), '');
});

test('현재 사용자가 없으면 복구를 시작하지 않는다', () => {
  const storage = { getItem: () => 'stored-room' };
  assert.equal(getStoredRoomRecoveryTarget({ currentUser: null, activeRoomId: '', localStorage: storage }), '');
});

test('이미 active room이 있으면 복구를 시작하지 않는다', () => {
  const storage = { getItem: () => 'stored-room' };
  assert.equal(getStoredRoomRecoveryTarget({ currentUser: user('current-1'), activeRoomId: 'active-room', localStorage: storage }), '');
});

test('방을 찾지 못하면 storage와 loading을 정리하고 기존 메시지를 표시한다', async () => {
  const context = baseParams();
  context.params.runtime.getRoom = async () => null;
  await recoverStoredRoom(context.params);
  assert.equal(context.storage.has(STORAGE_KEYS.activeRoomId), false);
  assert.equal(context.storage.has(STORAGE_KEYS.isRoomHost), false);
  assert.equal(context.state.loadingMessage, '');
  assert.equal(context.state.message, '이전에 참여했던 방이 없어져 대기화면으로 돌아왔습니다.');
  assert.equal(context.calls.some((call) => call.startsWith('join:')), false);
});

test('finished 방이면 storage 정리 후 대기화면 복귀 메시지를 표시한다', async () => {
  const context = baseParams();
  context.params.runtime.getRoom = async () => room({ status: 'finished' });
  await recoverStoredRoom(context.params);
  assert.equal(context.storage.has(STORAGE_KEYS.activeRoomId), false);
  assert.equal(context.state.screen, '');
  assert.equal(context.state.message, '이전에 참여했던 방이 없어져 대기화면으로 돌아왔습니다.');
});

test('대기 중인 방 복구 시 방장 여부와 좌석 index를 복원하고 waitingRoom으로 이동한다', async () => {
  const context = baseParams({ currentUser: user('host-1') });
  await recoverStoredRoom(context.params);
  assert.deepEqual(context.calls.slice(0, 2), ['get:stored-room', 'join:stored-room:host-1']);
  assert.equal(context.state.activeRoomId, 'stored-room');
  assert.equal(context.state.isRoomHost, true);
  assert.equal(context.state.activeRoomHostId, 'host-1');
  assert.equal((context.state.seats[2] as { id: string }).id, 'host-1');
  assert.equal(context.state.screen, 'waitingRoom');
  assert.equal(context.state.loadingMessage, '');
  assert.equal(context.state.message, '참여 중이던 방에 다시 입장했습니다.');
});

test('진행 중인 방 복구 시 game 화면으로 이동한다', async () => {
  const context = baseParams();
  context.params.runtime.getRoom = async () => room({ status: 'playing' });
  await recoverStoredRoom(context.params);
  assert.equal(context.state.screen, 'game');
});

test('관전자 결과에서는 플레이어 좌석을 임의 생성하지 않는다', async () => {
  const context = baseParams();
  context.params.runtime.joinRoom = async () => ({ role: 'spectator', seatIndex: null });
  await recoverStoredRoom(context.params);
  assert.deepEqual(context.state.seats, []);
});

test('joinRoom 오류 시 active room 관련 상태 전체 정리 후 lobby로 복귀한다', async () => {
  const context = baseParams();
  context.params.runtime.joinRoom = async () => { throw new Error('boom'); };
  await recoverStoredRoom(context.params);
  assert.equal(context.params.hostingRoomUserIdRef.current, '');
  assert.equal(context.state.activeRoomId, '');
  assert.equal(context.state.isRoomHost, false);
  assert.equal(context.state.activeRoomTitle, '');
  assert.equal(context.state.activeRoomHostId, '');
  assert.equal(context.state.screen, 'lobby');
  assert.equal(context.state.loadingMessage, '');
  assert.equal(context.state.message, 'boom');
});

test('취소된 늦은 응답은 상태를 변경하지 않는다', async () => {
  let cancelled = false;
  const pendingGet = deferred<RoomSummary | null>();
  const context = baseParams({ isCancelled: () => cancelled });
  context.params.runtime.getRoom = async () => pendingGet.promise;
  const recovering = recoverStoredRoom(context.params);
  assert.equal(context.state.loadingMessage, '참여 중이던 방을 확인하고 있습니다...');
  cancelled = true;
  pendingGet.resolve(room());
  await recovering;
  assert.equal(context.state.activeRoomId, '');
  assert.equal(context.state.loadingMessage, '참여 중이던 방을 확인하고 있습니다...');
});

test('다른 방에 이미 입장한 뒤 늦게 완료된 복구 응답은 현재 방을 덮지 않는다', async () => {
  const pendingJoin = deferred<{ role: 'player'; seatIndex: number }>();
  const context = baseParams();
  context.params.runtime.joinRoom = async () => pendingJoin.promise;
  const recovering = recoverStoredRoom(context.params);
  await Promise.resolve();
  context.state.activeRoomId = 'new-room';
  pendingJoin.resolve({ role: 'player', seatIndex: 1 });
  await recovering;
  assert.equal(context.state.activeRoomId, 'new-room');
  assert.equal(context.state.message, '');
});
