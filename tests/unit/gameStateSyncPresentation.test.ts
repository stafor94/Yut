import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import {
  beginGameStateSync,
  clearGameStateSync,
  completeGameStateSync,
  getGameStateSyncPresentation,
  subscribeGameStateSyncPresentation,
} from '../../src/app/flows/gameStateSyncPresentation.js';
import { openWaitingRoomForEntry, type RoomSummary } from '../../src/app/flows/roomEntryControllerFlow.js';
import { recoverStoredRoom } from '../../src/app/flows/storedRoomRecoveryFlow.js';
import {
  createGameSyncSubscriptionController,
  type GameSyncRuntime,
  type GameSyncSnapshotIdentity,
} from '../../src/app/hooks/gameSyncSubscription.js';

const flushController = () => new Promise<void>((resolve) => setImmediate(resolve));
const testUser = { uid: 'user-1' } as User;
const playingRoom: RoomSummary = {
  id: 'room-a',
  title: '진행 중인 방',
  hostId: 'host-1',
  status: 'playing',
  maxPlayers: 4,
  itemMode: true,
  stackedRollMode: false,
  playMode: 'individual',
  pieceCount: 4,
};

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('다른 방의 늦은 완료 신호는 현재 방 동기화를 해제하지 않는다', () => {
  clearGameStateSync();
  beginGameStateSync('room-a');

  assert.equal(completeGameStateSync('room-b'), false);
  assert.deepEqual(getGameStateSyncPresentation(), { roomId: 'room-a', status: 'loading' });

  assert.equal(completeGameStateSync('room-a'), true);
  assert.deepEqual(getGameStateSyncPresentation(), { roomId: 'room-a', status: 'ready' });
  clearGameStateSync('room-a');
});

test('최신 snapshot과 로그 적용이 끝난 뒤에만 동기화 상태를 ready로 바꾼다', async () => {
  clearGameStateSync();
  type Snapshot = GameSyncSnapshotIdentity & { logs: string[] };
  const controller = createGameSyncSubscriptionController<Snapshot>();
  const refs = { sequence: { current: 0 }, version: { current: 0 }, applying: { current: false } };
  const order: string[] = [];
  let emit: (state: Snapshot | null) => void = () => { throw new Error('구독 callback이 등록되지 않았습니다.'); };
  const unsubscribePresentation = subscribeGameStateSyncPresentation(() => {
    if (getGameStateSyncPresentation().status === 'ready') order.push('ready');
  });
  const runtime: GameSyncRuntime<Snapshot> = {
    activeRoomId: 'room-a',
    lastAppliedSequenceRef: refs.sequence,
    lastAppliedStateVersionRef: refs.version,
    applyingSyncedStateRef: refs.applying,
    replayMissingSequencesThenApply: async (state, _localSequence, remoteSequence) => {
      order.push(`apply:${state.logs.join('|')}`);
      refs.sequence.current = remoteSequence;
      refs.version.current = Number(state.turnVersion ?? 0);
    },
    applySyncedStateSnapshot: (state) => {
      order.push(`apply:${state.logs.join('|')}`);
      refs.sequence.current = Number(state.lastSequence ?? 0);
      refs.version.current = Number(state.turnVersion ?? 0);
    },
    enqueueAuthoritativeResultApplication: async (applyResult) => { await applyResult(); },
    scheduleApplyingReset: (reset) => reset(),
  };

  controller.updateRuntime(runtime);
  controller.syncRoom('room-a', (_roomId, callback) => {
    emit = callback;
    return () => undefined;
  });
  assert.deepEqual(getGameStateSyncPresentation(), { roomId: 'room-a', status: 'loading' });

  emit({ turnVersion: 4, lastSequence: 4, logs: ['최신 기록', '이전 기록'] });
  await flushController();

  assert.deepEqual(order, ['apply:최신 기록|이전 기록', 'ready']);
  assert.deepEqual(getGameStateSyncPresentation(), { roomId: 'room-a', status: 'ready' });
  controller.syncRoom('', () => () => undefined);
  controller.dispose();
  unsubscribePresentation();
});

test('진행 중 방에 처음 입장할 때 game 화면 전환 전에 동기화 게이트를 시작한다', async () => {
  clearGameStateSync();
  let screenAtEntry = '';
  let syncStatusAtEntry = '';
  await openWaitingRoomForEntry({
    nickname: '관전자',
    currentUser: testUser,
    userRef: { current: testUser },
    rememberUser: () => undefined,
    activeRoomIdRef: { current: '' },
    hostingRoomUserIdRef: { current: '' },
    leavingRoomRef: { current: false },
    room: playingRoom,
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
    onScreenChange: (screen) => {
      screenAtEntry = screen;
      syncStatusAtEntry = getGameStateSyncPresentation().status;
    },
    onMessage: () => undefined,
    onLoadingMessage: () => undefined,
    runtime: {
      firebaseConfigured: true,
      signInAsGuest: async () => testUser,
      getRoom: async () => null,
      removeRoomPlayer: async () => undefined,
      joinRoom: async () => ({ role: 'spectator', seatIndex: null }),
      leaveDuplicatePlayerRooms: async () => undefined,
      isRoomInGame: () => true,
      setTimeout: () => 0,
      localStorage: createStorage(),
    },
  });

  assert.equal(screenAtEntry, 'game');
  assert.equal(syncStatusAtEntry, 'loading');
  clearGameStateSync('room-a');
});

test('참가자 자동 재접속도 game 화면 전환 전에 동기화 게이트를 시작한다', async () => {
  clearGameStateSync();
  let screenAtEntry = '';
  let syncStatusAtEntry = '';
  await recoverStoredRoom({
    currentUser: testUser,
    nickname: '재접속자',
    hostingRoomUserIdRef: { current: '' },
    storedRoomId: playingRoom.id,
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
    onScreenChange: (screen) => {
      screenAtEntry = screen;
      syncStatusAtEntry = getGameStateSyncPresentation().status;
    },
    onMessage: () => undefined,
    onLoadingMessage: () => undefined,
    runtime: {
      getRoom: async () => playingRoom,
      joinRoom: async () => ({ role: 'player', seatIndex: 1 }),
      isRoomInGame: () => true,
      localStorage: createStorage(),
      getCurrentActiveRoomId: () => '',
    },
  });

  assert.equal(screenAtEntry, 'game');
  assert.equal(syncStatusAtEntry, 'loading');
  clearGameStateSync('room-a');
});
