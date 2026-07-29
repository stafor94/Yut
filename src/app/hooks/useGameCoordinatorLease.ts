import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  claimGameCoordinatorLease,
  GAME_COORDINATOR_RENEW_AHEAD_MS,
  GAME_COORDINATOR_RETRY_MS,
  getGameCoordinatorLeaseSnapshot,
  isGameCoordinatorLeaseActive,
  matchesActiveGameCoordinatorLease,
  type ClaimGameCoordinatorLeaseResult,
  type GameSeatSnapshot,
} from '../../features/room/services/roomService';
import {
  stabilizeClientGameCoordinatorLease,
  type ClientGameCoordinatorLease,
  type ClientGameCoordinatorLeaseContext,
} from './clientGameCoordinatorLease';
import { useDeadlineReached } from './useDeadlineReached';

export type { ClientGameCoordinatorLease } from './clientGameCoordinatorLease';

type Params = {
  activeRoomId: string;
  screen: string;
  candidateSeatId: string;
  candidateSeatIndex: number;
  eligible: boolean;
  gameSeats: GameSeatSnapshot[];
  lease: ClientGameCoordinatorLease;
  onLeaseChange: (lease: ClientGameCoordinatorLease) => void;
};

const resultToLease = (result: ClaimGameCoordinatorLeaseResult): ClientGameCoordinatorLease => ({
  coordinatorSeatId: result.coordinatorSeatId,
  coordinatorEpoch: result.coordinatorEpoch,
  coordinatorLeaseExpiresAt: result.coordinatorLeaseExpiresAt,
});

export function useGameCoordinatorLease(params: Params) {
  const nextLeaseContext: ClientGameCoordinatorLeaseContext = {
    roomId: params.activeRoomId,
    screen: params.screen,
    lease: params.lease,
  };
  const stableLeaseContextRef = useRef<ClientGameCoordinatorLeaseContext>(nextLeaseContext);
  const stableLeaseContext = stabilizeClientGameCoordinatorLease(stableLeaseContextRef.current, nextLeaseContext);
  useLayoutEffect(() => {
    stableLeaseContextRef.current = stableLeaseContext;
  }, [stableLeaseContext]);
  const stableLease = stableLeaseContext.lease;

  const leaseState = useMemo(() => ({ ...stableLease, gameSeats: params.gameSeats }), [
    params.gameSeats,
    stableLease.coordinatorEpoch,
    stableLease.coordinatorLeaseExpiresAt,
    stableLease.coordinatorSeatId,
  ]);
  const snapshot = useMemo(() => getGameCoordinatorLeaseSnapshot(leaseState), [leaseState]);
  const deadlineReached = useDeadlineReached(snapshot.coordinatorLeaseExpiresAt);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!params.activeRoomId || params.screen !== 'game' || !params.eligible || !params.candidateSeatId) return undefined;
    const now = Date.now();
    const currentOwnerActive = isGameCoordinatorLeaseActive(leaseState, now);
    const renewAt = snapshot.coordinatorSeatId === params.candidateSeatId
      ? snapshot.coordinatorLeaseExpiresAt - GAME_COORDINATOR_RENEW_AHEAD_MS
      : snapshot.coordinatorLeaseExpiresAt;
    const staggerMs = Math.max(0, params.candidateSeatIndex) * 120;
    const delayMs = currentOwnerActive
      ? Math.max(0, renewAt - now) + (snapshot.coordinatorSeatId === params.candidateSeatId ? 0 : staggerMs)
      : staggerMs;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void claimGameCoordinatorLease(params.activeRoomId, params.candidateSeatId)
        .then((result) => {
          if (disposed) return;
          if (result.status === 'acquired' || result.status === 'renewed' || result.status === 'held') {
            params.onLeaseChange(resultToLease(result));
          }
          if (result.status === 'unavailable') {
            window.setTimeout(() => { if (!disposed) setRetryTick((tick) => tick + 1); }, GAME_COORDINATOR_RETRY_MS);
          }
        })
        .catch(() => {
          window.setTimeout(() => { if (!disposed) setRetryTick((tick) => tick + 1); }, GAME_COORDINATOR_RETRY_MS);
        });
    }, delayMs);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [deadlineReached, leaseState, params.activeRoomId, params.candidateSeatId, params.candidateSeatIndex, params.eligible, params.onLeaseChange, params.screen, retryTick, snapshot.coordinatorEpoch, snapshot.coordinatorLeaseExpiresAt, snapshot.coordinatorSeatId]);

  return {
    coordinatorSeatId: snapshot.coordinatorSeatId,
    coordinatorEpoch: snapshot.coordinatorEpoch,
    coordinatorLeaseExpiresAt: snapshot.coordinatorLeaseExpiresAt,
    canCoordinate: Boolean(
      params.eligible
      && params.candidateSeatId
      && matchesActiveGameCoordinatorLease(leaseState, {
        coordinatorSeatId: params.candidateSeatId,
        coordinatorEpoch: snapshot.coordinatorEpoch,
      }),
    ),
  };
}
