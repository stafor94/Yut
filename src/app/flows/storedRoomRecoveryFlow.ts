import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import type { PieceCount, PlayMode, Seat } from '../appTypes';
import { STORAGE_KEYS, validateNickname } from '../preferences/localPreferences';
import { seatsWithJoinedPlayer } from '../selectors/seatSelectors';
import { beginGameStateSync } from './gameStateSyncPresentation';
import type { JoinRoomResult, RoomSummary } from './roomEntryControllerFlow';

type Screen = 'lobby' | 'waitingRoom' | 'game';
export type StoredRoomRecoveryResult = 'recovered' | 'permanent-failure' | 'retryable-failure' | 'cancelled' | 'ignored';

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

const getRecoveryErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = String((error as { code?: unknown }).code ?? '').toLowerCase();
  return code.includes('/') ? code.slice(code.lastIndexOf('/') + 1) : code;
};

export function classifyStoredRoomRecoveryError(error: unknown): 'permanent' | 'retryable' {
  const code = getRecoveryErrorCode(error);
  if (['not-found', 'permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition'].includes(code)) return 'permanent';
  if (['unavailable', 'deadline-exceeded', 'aborted', 'resource-exhausted', 'internal', 'unknown', 'network-request-failed', 'cancelled'].includes(code)) return 'retryable';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/존재하지 않는 방|이미 종료|종료되었거나 입장할 수 없는 방|입장할 수 없는 방|방이 가득/.test(message)) return 'permanent';
  return 'retryable';
}

const resetPermanentRecoveryState = (params: StoredRoomRecoveryFlowParams) => {
  params.hostingRoomUserIdRef.current = '';
  params.onActiveRoomIdChange('');
  params.onRoomHostChange(false);
  params.onActiveRoomTitleChange('');
  params.onRoomHostIdChange('');
  params.onScreenChange('lobby');
};

export async function recoverStoredRoom(params: StoredRoomRecoveryFlowParams): Promise<StoredRoomRecoveryResult> {
  const { currentUser, nickname, runtime, storedRoomId } = params;
  params.onLoadingMessage('참여 중이던 방을 확인하고 있습니다...');
  try {
    const storedRoom = await runtime.getRoom(storedRoomId);
    if (params.isCancelled()) return 'cancelled';
    if (!storedRoom || storedRoom.status === 'finished') {
      clearStoredRoomRecoveryStorage(runtime.localStorage);
      params.onLoadingMessage('');
      params.onMessage('이전에 참여했던 방이 없어져 대기화면으로 돌아왔습니다.');
      return 'permanent-failure';
    }

    const restoredAsHost = storedRoom.hostId === currentUser.uid;
    const restoredMaxPlayers = normalizeRecoveryMaxPlayers(storedRoom.maxPlayers);
    const joinResult = await runtime.joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
    if (!shouldApplyRecoveryResult(params)) return params.isCancelled() ? 'cancelled' : 'ignored';

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
    const authoritativeRoomInGame = typeof joinResult.roomInGame === 'boolean'
      ? joinResult.roomInGame
      : runtime.isRoomInGame(storedRoom);
    const nextScreen: Screen = authoritativeRoomInGame ? 'game' : 'waitingRoom';
    if (nextScreen === 'game') beginGameStateSync(storedRoom.id);
    params.onScreenChange(nextScreen);
    params.onLoadingMessage('');
    params.onMessage('참여 중이던 방에 다시 입장했습니다.');
    return 'recovered';
  } catch (error) {
    if (params.isCancelled()) return 'cancelled';
    params.onLoadingMessage('');
    if (classifyStoredRoomRecoveryError(error) === 'retryable') {
      params.onMessage(error instanceof Error && error.message
        ? error.message
        : '네트워크 문제로 이전 방 복구에 실패했습니다. 잠시 뒤 다시 시도합니다.');
      return 'retryable-failure';
    }
    clearStoredRoomRecoveryStorage(runtime.localStorage);
    resetPermanentRecoveryState(params);
    params.onMessage(error instanceof Error ? error.message : '이전 방 복구에 실패했습니다. 다시 참가해주세요.');
    return 'permanent-failure';
  }
}
