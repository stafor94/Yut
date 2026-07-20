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
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => listenAuthState((user) => {
    setCurrentUserId(user?.uid ?? '');
  }), []);

  useEffect(() => {
    const handleRefreshRooms = () => setRefreshVersion((version) => version + 1);
    window.addEventListener('yut:refresh-rooms', handleRefreshRooms);
    return () => window.removeEventListener('yut:refresh-rooms', handleRefreshRooms);
  }, []);

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
  }, [currentUserId, enabled, refreshVersion]);

  return rooms;
}
