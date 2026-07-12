import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { joinRoom, type JoinRoomResult, type RoomPlayer } from '../../features/room/services/roomService';
import type { PlayMode, Screen } from '../appState';

export type PresenceRecoveryOptions = {
  activeRoomId: string;
  screen: Screen;
  currentUserId: string;
  nickname: string;
  playMode: PlayMode;
  leavingRoomRef: MutableRefObject<boolean>;
  onRestored: () => void;
};

type PresenceRestoreRequest = {
  key: string;
  version: number;
};

export function makePresenceRestoreKey(roomId: string, userId: string, seatIndex: number, presenceGeneration: number) {
  return `${roomId}:${userId}:${seatIndex}:${presenceGeneration}`;
}

const getPresenceGeneration = (player: RoomPlayer) => Number(player.presenceGeneration ?? 0);

function isCurrentPresenceRestoreResult(
  request: PresenceRestoreRequest,
  currentKey: string,
  currentVersion: number,
  result: JoinRoomResult,
) {
  return currentKey === request.key && currentVersion === request.version && result.role === 'player';
}

export function usePresenceRecovery({
  activeRoomId,
  screen,
  currentUserId,
  nickname,
  playMode,
  leavingRoomRef,
  onRestored,
}: PresenceRecoveryOptions) {
  const presenceRestoreKeyRef = useRef('');
  const presenceRestoreRequestVersionRef = useRef(0);
  const onRestoredRef = useRef(onRestored);

  useEffect(() => { onRestoredRef.current = onRestored; }, [onRestored]);

  useEffect(() => {
    presenceRestoreRequestVersionRef.current += 1;
    presenceRestoreKeyRef.current = '';
  }, [activeRoomId, currentUserId, screen]);

  const handlePresencePlayerSnapshot = useCallback((player: RoomPlayer | undefined) => {
    const substitutedLocalPlayer = player && player.isAI && player.isSubstitutedByAI && !player.isSpectator ? player : undefined;
    if (!substitutedLocalPlayer) {
      presenceRestoreKeyRef.current = '';
      presenceRestoreRequestVersionRef.current += 1;
      return;
    }

    if (!activeRoomId || !currentUserId || screen !== 'game' || leavingRoomRef.current) return;

    const presenceGeneration = getPresenceGeneration(substitutedLocalPlayer);
    const restoreKey = makePresenceRestoreKey(activeRoomId, currentUserId, substitutedLocalPlayer.seatIndex, presenceGeneration);
    if (presenceRestoreKeyRef.current === restoreKey) return;

    presenceRestoreKeyRef.current = restoreKey;
    presenceRestoreRequestVersionRef.current += 1;
    const request = { key: restoreKey, version: presenceRestoreRequestVersionRef.current };

    void joinRoom(activeRoomId, { userId: currentUserId, nickname: substitutedLocalPlayer.nickname || nickname, playMode })
      .then((result) => {
        if (!isCurrentPresenceRestoreResult(request, presenceRestoreKeyRef.current, presenceRestoreRequestVersionRef.current, result)) {
          return;
        }
        onRestoredRef.current();
      })
      .catch(() => {
        if (presenceRestoreKeyRef.current === request.key && presenceRestoreRequestVersionRef.current === request.version) {
          presenceRestoreKeyRef.current = '';
        }
      });
  }, [activeRoomId, currentUserId, leavingRoomRef, nickname, playMode, screen]);

  return { handlePresencePlayerSnapshot };
}
