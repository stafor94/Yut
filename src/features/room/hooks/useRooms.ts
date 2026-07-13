import { useEffect, useState } from 'react';
import { auth, listenAuthState } from '../../../services/firebase/firebaseAuth';
import { subscribeActiveRooms, subscribeRoomPlayers, type RoomSummary } from '../services/roomService';
import { createRoomListSubscriptionController } from './roomListSubscription';

type UseRoomsOptions = {
  enabled?: boolean;
};

export function useRooms(options: UseRoomsOptions = {}) {
  const enabled = options.enabled ?? true;
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [currentUserId, setCurrentUserId] = useState(() => auth?.currentUser?.uid ?? '');

  useEffect(() => listenAuthState((user) => {
    setCurrentUserId(user?.uid ?? '');
  }), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = createRoomListSubscriptionController({
      subscribeRooms: subscribeActiveRooms,
      subscribePlayers: subscribeRoomPlayers,
      onRooms: setRooms,
      getCurrentUserId: () => currentUserId,
    });
    controller.start();
    return () => controller.dispose();
  }, [currentUserId, enabled]);

  return rooms;
}
