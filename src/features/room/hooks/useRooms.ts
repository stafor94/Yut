import { useEffect, useState } from 'react';
import { auth } from '../../../services/firebase/firebaseAuth';
import { subscribeActiveRooms, subscribeRoomPlayers, type RoomSummary } from '../services/roomService';
import { createRoomListSubscriptionController } from './roomListSubscription';

type UseRoomsOptions = {
  enabled?: boolean;
};

export function useRooms(options: UseRoomsOptions = {}) {
  const enabled = options.enabled ?? true;
  const [rooms, setRooms] = useState<RoomSummary[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = createRoomListSubscriptionController({
      subscribeRooms: subscribeActiveRooms,
      subscribePlayers: subscribeRoomPlayers,
      onRooms: setRooms,
      getCurrentUserId: () => auth?.currentUser?.uid ?? '',
    });
    controller.start();
    return () => controller.dispose();
  }, [enabled]);

  return rooms;
}
