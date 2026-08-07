import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { openWaitingRoomForEntry, type RoomEntryControllerParams } from '../../src/app/flows/roomEntryControllerFlow.js';
import { STORAGE_KEYS } from '../../src/app/preferences/localPreferences.js';

const user = (uid: string) => ({ uid }) as User;

const makeContext = (currentUser: User) => {
  const storage = new Map<string, string>();
  const calls: string[] = [];
  const state = { activeRoomId: '', isRoomHost: false, screen: '' };
  const params: RoomEntryControllerParams = {
    nickname: '테스트',
    currentUser,
    userRef: { current: currentUser },
    rememberUser: () => undefined,
    activeRoomIdRef: { current: '' },
    hostingRoomUserIdRef: { current: '' },
    leavingRoomRef: { current: false },
    onActiveRoomIdChange: (value) => { state.activeRoomId = value; },
    onRoomHostChange: (value) => { state.isRoomHost = value; },
    onActiveRoomTitleChange: () => undefined,
    onRoomHostIdChange: () => undefined,
    onPlayModeChange: () => undefined,
    onMaxPlayersChange: () => undefined,
    onItemModeChange: () => undefined,
    onStackedRollModeChange: () => undefined,
    onPieceCountChange: () => undefined,
    onSeatsChange: () => undefined,
    onScreenChange: (value) => { state.screen = value; },
    onMessage: () => undefined,
    onLoadingMessage: () => undefined,
    runtime: {
      firebaseConfigured: true,
      signInAsGuest: async () => currentUser,
      getRoom: async () => null,
      removeRoomPlayer: async () => undefined,
      joinRoom: async (roomId, entry) => {
        calls.push(`join:${roomId}:${entry.userId}`);
        return { role: 'player', seatIndex: 1, roomInGame: false };
      },
      leaveDuplicatePlayerRooms: async () => undefined,
      isRoomInGame: () => false,
      setTimeout: () => 0,
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => { storage.set(key, value); },
        removeItem: (key) => { storage.delete(key); },
      },
    },
  };
  return { params, storage, calls, state };
};

const waitingRoom = {
  id: 'room-2',
  title: '테스트 방',
  hostId: 'host-1',
  status: 'waiting' as const,
  maxPlayers: 2,
  itemMode: false,
  stackedRollMode: false,
  playMode: 'individual' as const,
  pieceCount: 4 as const,
};

test('명시적 guest join은 기존 참가 흐름을 유지하면서 recovery expected UID를 저장한다', async () => {
  const currentUser = user('guest-1');
  const context = makeContext(currentUser);
  await openWaitingRoomForEntry({ ...context.params, room: waitingRoom });
  assert.deepEqual(context.calls, ['join:room-2:guest-1']);
  assert.equal(context.storage.get(STORAGE_KEYS.activeRoomUserId), 'guest-1');
  assert.equal(context.state.activeRoomId, 'room-2');
  assert.equal(context.state.isRoomHost, false);
  assert.equal(context.state.screen, 'waitingRoom');
});

test('host room entry도 같은 recovery expected UID를 저장하고 guest join을 호출하지 않는다', async () => {
  const host = user('host-1');
  const context = makeContext(host);
  await openWaitingRoomForEntry({ ...context.params, room: waitingRoom, asHost: true, hostUserOverride: host });
  assert.deepEqual(context.calls, []);
  assert.equal(context.storage.get(STORAGE_KEYS.activeRoomUserId), 'host-1');
  assert.equal(context.state.activeRoomId, 'room-2');
  assert.equal(context.state.isRoomHost, true);
  assert.equal(context.state.screen, 'waitingRoom');
});
