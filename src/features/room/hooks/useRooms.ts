import { useEffect, useRef, useState } from 'react';
import { auth, listenAuthState } from '../../../services/firebase/firebaseAuth';
import { subscribeRoomPlayers, type RoomSummary } from '../services/roomService';
import { subscribeCappedActiveRooms } from '../services/roomListStore';
import { createRoomListSubscriptionController } from './roomListSubscription';

type UseRoomsOptions = {
  enabled?: boolean;
};

export function useRooms(options: UseRoomsOptions = {}) {
  const enabled = options.enabled ?? true;
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [currentUserId, setCurrentUserId] = useState(() => auth?.currentUser?.uid ?? '');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pendingRefreshVersionRef = useRef<number | null>(null);

  useEffect(() => listenAuthState((user) => {
    setCurrentUserId(user?.uid ?? '');
  }), []);

  useEffect(() => {
    const handleRefreshRooms = () => {
      setRefreshVersion((version) => {
        const nextVersion = version + 1;
        pendingRefreshVersionRef.current = nextVersion;
        return nextVersion;
      });
    };
    window.addEventListener('yut:refresh-rooms', handleRefreshRooms);
    return () => window.removeEventListener('yut:refresh-rooms', handleRefreshRooms);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = createRoomListSubscriptionController({
      subscribeRooms: subscribeCappedActiveRooms,
      subscribePlayers: subscribeRoomPlayers,
      onRooms: (nextRooms) => {
        setRooms(nextRooms);
        if (pendingRefreshVersionRef.current !== refreshVersion) return;
        pendingRefreshVersionRef.current = null;
        window.dispatchEvent(new Event('yut:rooms-refreshed'));
      },
      getCurrentUserId: () => currentUserId,
    });
    controller.start();
    return () => controller.dispose();
  }, [currentUserId, enabled, refreshVersion]);

  return rooms;
}
