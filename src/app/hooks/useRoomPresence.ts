import { useEffect } from 'react';
import { cleanupStaleRooms, heartbeatRoomPlayer } from '../../features/room/services/roomService';

export function useRoomPresence(activeRoomId: string, localSeatId: string) {
  useEffect(() => {
    if (!activeRoomId || !localSeatId) return undefined;
    void heartbeatRoomPlayer(activeRoomId, localSeatId);
    const heartbeatTimer = window.setInterval(() => { void heartbeatRoomPlayer(activeRoomId, localSeatId); }, 15000);
    return () => window.clearInterval(heartbeatTimer);
  }, [activeRoomId, localSeatId]);

  useEffect(() => {
    void cleanupStaleRooms(undefined, activeRoomId);
    const cleanupTimer = window.setInterval(() => { void cleanupStaleRooms(undefined, activeRoomId); }, 30000);
    return () => window.clearInterval(cleanupTimer);
  }, [activeRoomId]);
}
