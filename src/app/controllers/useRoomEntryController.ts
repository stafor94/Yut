import { useCallback } from 'react';
import { getRoom, isRoomInGame, joinRoom, leaveDuplicatePlayerRooms, removeRoomPlayer, type RoomSummary } from '../../features/room/services/roomService';
import { isFirebaseConfigured } from '../../services/firebase/firebaseApp';
import { signInAsGuest } from '../../services/firebase/firebaseAuth';
import { openWaitingRoomForEntry, type EnterableRoom, type RoomEntryControllerParams } from '../flows/roomEntryControllerFlow';

type UseRoomEntryControllerParams = Omit<RoomEntryControllerParams, 'runtime'>;

export function useRoomEntryController(params: UseRoomEntryControllerParams) {
  const openWaitingRoom = useCallback((
    room: EnterableRoom,
    nextMessage = '',
    asHost = false,
    hostUserOverride: Parameters<typeof openWaitingRoomForEntry>[0]['hostUserOverride'] = null,
  ) => openWaitingRoomForEntry({
    ...params,
    room,
    nextMessage,
    asHost,
    hostUserOverride,
    runtime: {
      firebaseConfigured: isFirebaseConfigured,
      signInAsGuest,
      getRoom,
      removeRoomPlayer,
      joinRoom,
      leaveDuplicatePlayerRooms,
      isRoomInGame: (roomSummary: RoomSummary) => isRoomInGame(roomSummary),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      localStorage: window.localStorage,
    },
  }), [params]);

  return { openWaitingRoom };
}
