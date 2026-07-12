import { useEffect, useState } from 'react';
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
    });
    controller.start();
    return () => controller.dispose();
  }, [enabled]);

  return rooms;
}
