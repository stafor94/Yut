import { useEffect } from 'react';
import {
  cleanupCurrentRoomPresence,
  heartbeatRoomPlayer,
  releaseRoomPresenceCleanupLease,
} from '../../features/room/services/roomService';
import {
  ROOM_PRESENCE_CLEANUP_INTERVAL_MS,
} from '../../features/room/services/roomPresenceCleanupPolicy';

export function useRoomPresence(activeRoomId: string, localSeatId: string, options: { canCleanup?: boolean; canRefreshRoomSummary?: boolean } = {}) {
  const canCleanup = Boolean(options.canCleanup);
  const canRefreshRoomSummary = Boolean(options.canRefreshRoomSummary);

  useEffect(() => {
    if (!activeRoomId || !localSeatId) return undefined;
    let disposed = false;
    let cycleInFlight = false;

    const runPresenceCycle = async () => {
      if (disposed || cycleInFlight) return;
      cycleInFlight = true;
      try {
        const heartbeatSucceeded = await heartbeatRoomPlayer(activeRoomId, localSeatId, { refreshRoomSummary: canRefreshRoomSummary });
        if (!disposed && heartbeatSucceeded && canCleanup) {
          await cleanupCurrentRoomPresence(activeRoomId, localSeatId);
        }
      } catch {
        // 다음 presence 주기에 다시 시도한다.
      } finally {
        cycleInFlight = false;
      }
    };

    const handleResume = () => { void runPresenceCycle(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void runPresenceCycle();
    };

    void runPresenceCycle();
    const presenceTimer = window.setInterval(() => { void runPresenceCycle(); }, ROOM_PRESENCE_CLEANUP_INTERVAL_MS);
    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(presenceTimer);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (canCleanup) void releaseRoomPresenceCleanupLease(activeRoomId, localSeatId);
    };
  }, [activeRoomId, canCleanup, canRefreshRoomSummary, localSeatId]);
}
