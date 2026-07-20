import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import type { PieceCount, PlayMode, Seat } from '../appTypes';
import { STORAGE_KEYS, validateNickname } from '../preferences/localPreferences';
import { seatsWithJoinedPlayer } from '../selectors/seatSelectors';
import { beginGameStateSync } from './gameStateSyncPresentation';
import type { JoinRoomResult, RoomSummary } from './roomEntryControllerFlow';

type Screen = 'lobby' | 'waitingRoom' | 'game';

type StoredRoomRecoveryActions = {
  onActiveRoomIdChange: (activeRoomId: string) => void;
  onRoomHostChange: (isRoomHost: boolean) => void;
  onActiveRoomTitleChange: (activeRoomTitle: string) => void;
  onRoomHostIdChange: (activeRoomHostId: string) => void;
  onPlayModeChange: (playMode: PlayMode) => void;
  onMaxPlayersChange: (maxPlayers: 2 | 3 | 4) => void;
  onItemModeChange: (itemMode: boolean) => void;
  onStackedRollModeChange: (stackedRollMode: boolean) => void;
  onPieceCountChange: (pieceCount: PieceCount) => void;
  onSeatsChange: (seats: Seat[]) => void;
  onScreenChange: (screen: Screen) => void;
  onMessage: (message: string) => void;
  onLoadingMessage: (loadingMessage: string) => void;
};

type StoredRoomRecoveryRuntime = {
  getRoom: (roomId: string) => Promise<RoomSummary | null>;
  joinRoom: (roomId: string, params: { userId: string; nickname: string; playMode: PlayMode }) => Promise<JoinRoomResult>;
  isRoomInGame: (room: RoomSummary) => boolean;
  localStorage: Pick<Storage, 'getItem' | 'removeItem'>;
  getCurrentActiveRoomId: () => string;
};

export type StoredRoomRecoveryFlowParams = StoredRoomRecoveryActions & {
  currentUser: User;
  nickname: string;
  hostingRoomUserIdRef: MutableRefObject<string>;
  storedRoomId: string;
  isCancelled: () => boolean;
  runtime: StoredRoomRecoveryRuntime;
};

export function getStoredRoomRecoveryTarget(params: { currentUser: User | null; activeRoomId: string; nickname: string; localStorage: Pick<Storage, 'getItem'> }) {
  if (!params.currentUser || params.activeRoomId || !validateNickname(params.nickname).valid) return '';
  return params.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
}

const normalizeRecoveryMaxPlayers = (value: number): 2 | 3 | 4 => (value === 2 || value === 3 || value === 4 ? value : 4);

const clearStoredRoomRecoveryStorage = (storage: StoredRoomRecoveryRuntime['localStorage']) => {
  storage.removeItem(STORAGE_KEYS.activeRoomId);
  storage.removeItem(STORAGE_KEYS.isRoomHost);
};

const shouldApplyRecoveryResult = (params: StoredRoomRecoveryFlowParams) => (
  !params.isCancelled()
  && !params.runtime.getCurrentActiveRoomId()
);

export async function recoverStoredRoom(params: StoredRoomRecoveryFlowParams) {
  const { currentUser, nickname, runtime, storedRoomId } = params;
  params.onLoadingMessage('참여 중이던 방을 확인하고 있습니다...');
  try {
    const storedRoom = await runtime.getRoom(storedRoomId);
    if (params.isCancelled()) return;
    if (!storedRoom || storedRoom.status === 'finished') {
      clearStoredRoomRecoveryStorage(runtime.localStorage);
      params.onLoadingMessage('');
      params.onMessage('이전에 참여했던 방이 없어져 대기화면으로 돌아왔습니다.');
      return;
    }

    const restoredAsHost = storedRoom.hostId === currentUser.uid;
    const restoredMaxPlayers = normalizeRecoveryMaxPlayers(storedRoom.maxPlayers);
    const joinResult = await runtime.joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
    if (!shouldApplyRecoveryResult(params)) return;

    params.onActiveRoomIdChange(storedRoom.id);
    params.onRoomHostChange(restoredAsHost);
    params.onActiveRoomTitleChange(storedRoom.title);
    params.onRoomHostIdChange(storedRoom.hostId ?? '');
    params.onPlayModeChange(storedRoom.playMode);
    params.onMaxPlayersChange(restoredMaxPlayers);
    params.onItemModeChange(storedRoom.itemMode);
    params.onStackedRollModeChange(Boolean(storedRoom.stackedRollMode));
    params.onPieceCountChange(storedRoom.pieceCount ?? 4);
    if (joinResult.role === 'player') {
      params.onSeatsChange(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
    }
    const nextScreen: Screen = runtime.isRoomInGame(storedRoom) ? 'game' : 'waitingRoom';
    if (nextScreen === 'game') beginGameStateSync(storedRoom.id);
    params.onScreenChange(nextScreen);
    params.onLoadingMessage('');
    params.onMessage('참여 중이던 방에 다시 입장했습니다.');
  } catch (error) {
    if (params.isCancelled()) return;
    clearStoredRoomRecoveryStorage(runtime.localStorage);
    params.hostingRoomUserIdRef.current = '';
    params.onActiveRoomIdChange('');
    params.onRoomHostChange(false);
    params.onActiveRoomTitleChange('');
    params.onRoomHostIdChange('');
    params.onScreenChange('lobby');
    params.onLoadingMessage('');
    params.onMessage(error instanceof Error ? error.message : '이전 방 복구에 실패했습니다. 다시 참가해주세요.');
  }
}
