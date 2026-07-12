import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { joinRoom, type RoomPlayer } from '../../features/room/services/roomService';
import type { PlayMode, Screen } from '../appState';
import { getPresenceRestoreKey, shouldApplyPresenceRestoreResult } from '../flows/presenceRecovery';

export type PresenceRecoveryOptions = {
  activeRoomId: string;
  screen: Screen;
  currentUserId: string;
  nickname: string;
  playMode: PlayMode;
  leavingRoomRef: MutableRefObject<boolean>;
  onRestored: () => void;
};

type PresenceRecoveryContext = Pick<PresenceRecoveryOptions, 'activeRoomId' | 'screen' | 'currentUserId' | 'nickname' | 'playMode'>;

export function usePresenceRecovery({
  activeRoomId,
  screen,
  currentUserId,
  nickname,
  playMode,
  leavingRoomRef,
  onRestored,
}: PresenceRecoveryOptions) {
  const restoreKeyRef = useRef('');
  const requestVersionRef = useRef(0);
  const contextRef = useRef<PresenceRecoveryContext>({ activeRoomId, screen, currentUserId, nickname, playMode });
  const onRestoredRef = useRef(onRestored);

  contextRef.current = { activeRoomId, screen, currentUserId, nickname, playMode };
  onRestoredRef.current = onRestored;

  useEffect(() => {
    requestVersionRef.current += 1;
    restoreKeyRef.current = '';
  }, [activeRoomId, currentUserId, screen]);

  const handlePresencePlayerSnapshot = useCallback((player: RoomPlayer | undefined) => {
    const substitutedPlayer = player && player.isAI && player.isSubstitutedByAI && !player.isSpectator ? player : undefined;
    if (!substitutedPlayer) {
      if (restoreKeyRef.current) {
        restoreKeyRef.current = '';
        requestVersionRef.current += 1;
      }
      return;
    }

    const context = contextRef.current;
    if (!context.activeRoomId || !context.currentUserId || context.screen !== 'game' || leavingRoomRef.current) return;

    const expectedPresenceEpoch = Number(substitutedPlayer.presenceEpoch ?? 0);
    const restoreKey = getPresenceRestoreKey(context.activeRoomId, context.currentUserId, substitutedPlayer.seatIndex, expectedPresenceEpoch);
    if (restoreKeyRef.current === restoreKey) return;

    restoreKeyRef.current = restoreKey;
    requestVersionRef.current += 1;
    const requestVersion = requestVersionRef.current;
    const requestedRoomId = context.activeRoomId;
    const requestedUserId = context.currentUserId;

    void joinRoom(requestedRoomId, {
      userId: requestedUserId,
      nickname: substitutedPlayer.nickname || context.nickname,
      playMode: context.playMode,
      expectedPresenceEpoch,
    })
      .then((result) => {
        if (restoreKeyRef.current !== restoreKey || requestVersionRef.current !== requestVersion) return;
        const latestContext = contextRef.current;
        if (!shouldApplyPresenceRestoreResult({
          requestedRoomId,
          currentRoomId: latestContext.activeRoomId,
          requestedUserId,
          currentUserId: latestContext.currentUserId,
          requestedPresenceEpoch: expectedPresenceEpoch,
          restoredPresenceEpoch: result.presenceEpoch,
          role: result.role,
          screen: latestContext.screen,
        })) {
          restoreKeyRef.current = '';
          return;
        }
        onRestoredRef.current();
      })
      .catch(() => {
        if (restoreKeyRef.current === restoreKey && requestVersionRef.current === requestVersion) {
          restoreKeyRef.current = '';
        }
      });
  }, [leavingRoomRef]);

  return { handlePresencePlayerSnapshot };
}
