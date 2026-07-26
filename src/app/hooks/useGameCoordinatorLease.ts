import { useEffect, useMemo, useState } from 'react';
import {
  claimGameCoordinatorLease,
  GAME_COORDINATOR_RENEW_AHEAD_MS,
  GAME_COORDINATOR_RETRY_MS,
  getGameCoordinatorLeaseSnapshot,
  matchesActiveGameCoordinatorLease,
  type ClaimGameCoordinatorLeaseResult,
  type GameSeatSnapshot,
  type SyncedGameState,
} from '../../features/room/services/roomService';
import { useDeadlineReached } from './useDeadlineReached';

export type ClientGameCoordinatorLease = Pick<
  SyncedGameState,
  'coordinatorSeatId' | 'coordinatorEpoch' | 'coordinatorLeaseExpiresAt'
>;

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
  const leaseState = useMemo(() => ({ ...params.lease, gameSeats: params.gameSeats }), [params.gameSeats, params.lease]);
  const snapshot = useMemo(() => getGameCoordinatorLeaseSnapshot(leaseState), [
    params.lease.coordinatorEpoch,
    params.lease.coordinatorLeaseExpiresAt,
    params.lease.coordinatorSeatId,
    leaseState,
  ]);
  const deadlineReached = useDeadlineReached(snapshot.coordinatorLeaseExpiresAt);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!params.activeRoomId || params.screen !== 'game' || !params.eligible || !params.candidateSeatId) return undefined;
    const now = Date.now();
    const currentOwnerActive = snapshot.coordinatorSeatId && snapshot.coordinatorLeaseExpiresAt > now;
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
  }, [deadlineReached, params.activeRoomId, params.candidateSeatId, params.candidateSeatIndex, params.eligible, params.onLeaseChange, params.screen, retryTick, snapshot.coordinatorEpoch, snapshot.coordinatorLeaseExpiresAt, snapshot.coordinatorSeatId]);

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
