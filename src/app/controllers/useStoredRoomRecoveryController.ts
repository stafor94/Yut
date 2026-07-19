import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { User } from 'firebase/auth';
import { getRoom, isRoomInGame, joinRoom, type RoomSummary } from '../../features/room/services/roomService';
import type { PieceCount, PlayMode, Seat } from '../appTypes';
import { STORAGE_KEYS } from '../preferences/localPreferences';
import { getStoredRoomRecoveryTarget, recoverStoredRoom } from '../flows/storedRoomRecoveryFlow';

type Screen = 'lobby' | 'waitingRoom' | 'game';

type UseStoredRoomRecoveryControllerParams = {
  currentUser: User | null;
  activeRoomId: string;
  nickname: string;
  hostingRoomUserIdRef: MutableRefObject<string>;
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

export function useStoredRoomRecoveryController(params: UseStoredRoomRecoveryControllerParams) {
  const recoveringRoomIdRef = useRef('');
  const activeRoomIdRef = useRef(params.activeRoomId);

  useEffect(() => { activeRoomIdRef.current = params.activeRoomId; }, [params.activeRoomId]);

  useEffect(() => {
    const currentUser = params.currentUser;
    const storedRoomId = getStoredRoomRecoveryTarget({ currentUser, activeRoomId: params.activeRoomId, localStorage: window.localStorage });
    if (!currentUser || !storedRoomId || recoveringRoomIdRef.current === storedRoomId) return;
    let cancelled = false;
    recoveringRoomIdRef.current = storedRoomId;
    void recoverStoredRoom({
      currentUser,
      nickname: params.nickname,
      hostingRoomUserIdRef: params.hostingRoomUserIdRef,
      onActiveRoomIdChange: params.onActiveRoomIdChange,
      onRoomHostChange: params.onRoomHostChange,
      onActiveRoomTitleChange: params.onActiveRoomTitleChange,
      onRoomHostIdChange: params.onRoomHostIdChange,
      onPlayModeChange: params.onPlayModeChange,
      onMaxPlayersChange: params.onMaxPlayersChange,
      onItemModeChange: params.onItemModeChange,
      onStackedRollModeChange: params.onStackedRollModeChange,
      onPieceCountChange: params.onPieceCountChange,
      onSeatsChange: params.onSeatsChange,
      onScreenChange: params.onScreenChange,
      onMessage: params.onMessage,
      onLoadingMessage: params.onLoadingMessage,
      storedRoomId,
      isCancelled: () => cancelled || recoveringRoomIdRef.current !== storedRoomId,
      runtime: {
        getRoom,
        joinRoom,
        isRoomInGame: (room: RoomSummary) => isRoomInGame(room),
        localStorage: window.localStorage,
        getCurrentActiveRoomId: () => activeRoomIdRef.current,
      },
    }).finally(() => {
      if (recoveringRoomIdRef.current === storedRoomId) recoveringRoomIdRef.current = '';
    });
    return () => { cancelled = true; };
  }, [
    params.activeRoomId,
    params.currentUser,
    params.hostingRoomUserIdRef,
    params.nickname,
    params.onActiveRoomIdChange,
    params.onItemModeChange,
    params.onLoadingMessage,
    params.onMaxPlayersChange,
    params.onMessage,
    params.onPieceCountChange,
    params.onPlayModeChange,
    params.onRoomHostChange,
    params.onRoomHostIdChange,
    params.onScreenChange,
    params.onSeatsChange,
    params.onStackedRollModeChange,
    params.onActiveRoomTitleChange,
  ]);
}
