import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { clearGameStateSync, getGameStateSyncPresentation } from '../../src/app/flows/gameStateSyncPresentation.js';
import { openWaitingRoomForEntry, type RoomEntryControllerParams, type RoomSummary } from '../../src/app/flows/roomEntryControllerFlow.js';
import { recoverStoredRoom, type StoredRoomRecoveryFlowParams } from '../../src/app/flows/storedRoomRecoveryFlow.js';

const user = { uid: 'user-1' } as User;
const room = (status: RoomSummary['status']): RoomSummary => ({
  id: 'room-1', title: '테스트 방', hostId: 'host-1', status, maxPlayers: 2,
  itemMode: false, stackedRollMode: false, playMode: 'individual', pieceCount: 4,
});

function createEntryParams(joinRoom: RoomEntryControllerParams['runtime']['joinRoom']) {
  let screen = '';
  let syncStatusAtScreen = '';
  const params: RoomEntryControllerParams = {
    nickname: '참가자',
    currentUser: user,
    userRef: { current: user },
    rememberUser: () => undefined,
    activeRoomIdRef: { current: '' },
    hostingRoomUserIdRef: { current: '' },
    leavingRoomRef: { current: false },
    onActiveRoomIdChange: () => undefined,
    onRoomHostChange: () => undefined,
    onActiveRoomTitleChange: () => undefined,
    onRoomHostIdChange: () => undefined,
    onPlayModeChange: () => undefined,
    onMaxPlayersChange: () => undefined,
    onItemModeChange: () => undefined,
    onStackedRollModeChange: () => undefined,
    onPieceCountChange: () => undefined,
    onSeatsChange: () => undefined,
    onScreenChange: (nextScreen) => {
      screen = nextScreen;
      syncStatusAtScreen = getGameStateSyncPresentation().status;
    },
    onMessage: () => undefined,
    onLoadingMessage: () => undefined,
    runtime: {
      firebaseConfigured: true,
      signInAsGuest: async () => user,
      getRoom: async () => null,
      removeRoomPlayer: async () => undefined,
      joinRoom,
      leaveDuplicatePlayerRooms: async () => undefined,
      isRoomInGame: (summary) => summary.status === 'playing',
      setTimeout: () => 0,
      localStorage: { getItem: () => null, removeItem: () => undefined },
    },
  };
  return { params, getScreen: () => screen, getSyncStatusAtScreen: () => syncStatusAtScreen };
}

function createRecoveryParams(storedRoom: RoomSummary, roomInGame: boolean) {
  let screen = '';
  let syncStatusAtScreen = '';
  const storage = new Map([['yut-online:activeRoomId', storedRoom.id], ['yut-online:isRoomHost', 'false']]);
  const params: StoredRoomRecoveryFlowParams = {
    currentUser: user,
    nickname: '재접속자',
    hostingRoomUserIdRef: { current: '' },
    storedRoomId: storedRoom.id,
    isCancelled: () => false,
    onActiveRoomIdChange: () => undefined,
    onRoomHostChange: () => undefined,
    onActiveRoomTitleChange: () => undefined,
    onRoomHostIdChange: () => undefined,
    onPlayModeChange: () => undefined,
    onMaxPlayersChange: () => undefined,
    onItemModeChange: () => undefined,
    onStackedRollModeChange: () => undefined,
    onPieceCountChange: () => undefined,
    onSeatsChange: () => undefined,
    onScreenChange: (nextScreen) => {
      screen = nextScreen;
      syncStatusAtScreen = getGameStateSyncPresentation().status;
    },
    onMessage: () => undefined,
    onLoadingMessage: () => undefined,
    runtime: {
      getRoom: async () => storedRoom,
      joinRoom: async () => ({ role: 'player', seatIndex: 0, roomInGame }),
      isRoomInGame: (summary) => summary.status === 'playing',
      localStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => { storage.delete(key); } },
      getCurrentActiveRoomId: () => '',
    },
  };
  return { params, getScreen: () => screen, getSyncStatusAtScreen: () => syncStatusAtScreen };
}

test('목록 room은 waiting이어도 authoritative join 결과가 in-game이면 game으로 이동하고 sync gate를 먼저 연다', async () => {
  clearGameStateSync();
  const context = createEntryParams(async () => ({ role: 'player', seatIndex: 0, roomInGame: true }));
  await openWaitingRoomForEntry({ ...context.params, room: room('waiting') });
  assert.equal(context.getScreen(), 'game');
  assert.equal(context.getSyncStatusAtScreen(), 'loading');
  clearGameStateSync('room-1');
});

test('목록 room은 playing이어도 authoritative join 결과가 waiting이면 waitingRoom으로 이동한다', async () => {
  clearGameStateSync();
  const context = createEntryParams(async () => ({ role: 'player', seatIndex: 0, roomInGame: false }));
  await openWaitingRoomForEntry({ ...context.params, room: room('playing') });
  assert.equal(context.getScreen(), 'waitingRoom');
  assert.notEqual(context.getSyncStatusAtScreen(), 'loading');
});

test('저장 room은 waiting이어도 authoritative join 결과가 in-game이면 game으로 이동하고 sync gate를 먼저 연다', async () => {
  clearGameStateSync();
  const context = createRecoveryParams(room('waiting'), true);
  await recoverStoredRoom(context.params);
  assert.equal(context.getScreen(), 'game');
  assert.equal(context.getSyncStatusAtScreen(), 'loading');
  clearGameStateSync('room-1');
});

test('저장 room은 playing이어도 authoritative join 결과가 waiting이면 waitingRoom으로 이동한다', async () => {
  clearGameStateSync();
  const context = createRecoveryParams(room('playing'), false);
  await recoverStoredRoom(context.params);
  assert.equal(context.getScreen(), 'waitingRoom');
  assert.notEqual(context.getSyncStatusAtScreen(), 'loading');
});
