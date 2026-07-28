import assert from 'node:assert/strict';
import test from 'node:test';
import type { User } from 'firebase/auth';
import { STORAGE_KEYS } from '../../src/app/preferences/localPreferences.js';
import { classifyStoredRoomRecoveryError, recoverStoredRoom, type StoredRoomRecoveryFlowParams } from '../../src/app/flows/storedRoomRecoveryFlow.js';
import type { RoomSummary } from '../../src/app/flows/roomEntryControllerFlow.js';

const currentUser = { uid: 'user-1' } as User;
const storedRoom: RoomSummary = {
  id: 'stored-room', title: '저장 방', hostId: 'host-1', status: 'waiting', maxPlayers: 2,
  itemMode: false, stackedRollMode: false, playMode: 'individual', pieceCount: 4,
};

function createParams(error: Error & { code?: string }) {
  const storage = new Map<string, string>([[STORAGE_KEYS.activeRoomId, storedRoom.id], [STORAGE_KEYS.isRoomHost, 'false']]);
  const state = { activeRoomId: '', screen: '', loading: '', message: '' };
  const params: StoredRoomRecoveryFlowParams = {
    currentUser,
    nickname: '재접속자',
    hostingRoomUserIdRef: { current: '' },
    storedRoomId: storedRoom.id,
    isCancelled: () => false,
    onActiveRoomIdChange: (value) => { state.activeRoomId = value; },
    onRoomHostChange: () => undefined,
    onActiveRoomTitleChange: () => undefined,
    onRoomHostIdChange: () => undefined,
    onPlayModeChange: () => undefined,
    onMaxPlayersChange: () => undefined,
    onItemModeChange: () => undefined,
    onStackedRollModeChange: () => undefined,
    onPieceCountChange: () => undefined,
    onSeatsChange: () => undefined,
    onScreenChange: (value) => { state.screen = value; },
    onMessage: (value) => { state.message = value; },
    onLoadingMessage: (value) => { state.loading = value; },
    runtime: {
      getRoom: async () => storedRoom,
      joinRoom: async () => { throw error; },
      isRoomInGame: () => false,
      localStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => { storage.delete(key); } },
      getCurrentActiveRoomId: () => state.activeRoomId,
    },
  };
  return { params, storage, state };
}

test('Firestore unavailable 오류는 retryable로 분류한다', () => {
  const error = Object.assign(new Error('network unavailable'), { code: 'firestore/unavailable' });
  assert.equal(classifyStoredRoomRecoveryError(error), 'retryable');
});

test('일시적 자동 복구 오류는 activeRoomId와 isRoomHost 복구 포인터를 보존한다', async () => {
  const error = Object.assign(new Error('network unavailable'), { code: 'firestore/unavailable' });
  const context = createParams(error);
  assert.equal(await recoverStoredRoom(context.params), 'retryable-failure');
  assert.equal(context.storage.get(STORAGE_KEYS.activeRoomId), storedRoom.id);
  assert.equal(context.storage.get(STORAGE_KEYS.isRoomHost), 'false');
  assert.equal(context.state.screen, '');
  assert.equal(context.state.loading, '');
});

test('영구 입장 오류만 저장된 복구 포인터를 제거하고 lobby 상태로 정리한다', async () => {
  const context = createParams(new Error('존재하지 않는 방입니다.'));
  assert.equal(await recoverStoredRoom(context.params), 'permanent-failure');
  assert.equal(context.storage.has(STORAGE_KEYS.activeRoomId), false);
  assert.equal(context.storage.has(STORAGE_KEYS.isRoomHost), false);
  assert.equal(context.state.screen, 'lobby');
  assert.equal(context.state.loading, '');
});
