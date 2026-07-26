export const GAME_COORDINATOR_LEASE_MS = 15_000;
export const GAME_COORDINATOR_RENEW_AHEAD_MS = 5_000;
export const GAME_COORDINATOR_RETRY_MS = 1_000;

export type GameCoordinatorLeaseSeat = {
  id: string;
  isAI?: boolean;
  isEmpty?: boolean;
  isSubstitutedByAI?: boolean;
};

export type GameCoordinatorLeaseState = {
  coordinatorSeatId?: unknown;
  coordinatorEpoch?: unknown;
  coordinatorLeaseExpiresAt?: unknown;
  gameSeats?: GameCoordinatorLeaseSeat[];
  autoPlayBySeatId?: Record<string, boolean>;
};

export type GameCoordinatorLeaseToken = {
  coordinatorSeatId: string;
  coordinatorEpoch: number;
};

export type GameCoordinatorLeaseSnapshot = GameCoordinatorLeaseToken & {
  coordinatorLeaseExpiresAt: number;
};

export type GameCoordinatorLeaseDecision = GameCoordinatorLeaseSnapshot & {
  status: 'acquired' | 'renewed' | 'held' | 'ineligible';
};

export const getCoordinatorLeaseTimestampMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value instanceof Date) return value.getTime();
  const millis = Number(value ?? 0);
  return Number.isFinite(millis) ? millis : 0;
};

export const normalizeCoordinatorEpoch = (value: unknown) => {
  const epoch = Number(value ?? 0);
  return Number.isFinite(epoch) && epoch > 0 ? Math.floor(epoch) : 0;
};

export const getGameCoordinatorLeaseSnapshot = (state: GameCoordinatorLeaseState | null | undefined): GameCoordinatorLeaseSnapshot => ({
  coordinatorSeatId: typeof state?.coordinatorSeatId === 'string' ? state.coordinatorSeatId : '',
  coordinatorEpoch: normalizeCoordinatorEpoch(state?.coordinatorEpoch),
  coordinatorLeaseExpiresAt: getCoordinatorLeaseTimestampMillis(state?.coordinatorLeaseExpiresAt),
});

export const isEligibleGameCoordinatorSeat = (seat: GameCoordinatorLeaseSeat | undefined) => Boolean(
  seat
  && seat.id
  && !seat.isEmpty
  && !seat.isAI
  && !seat.isSubstitutedByAI,
);

export const isGameCoordinatorCandidateEligible = (state: GameCoordinatorLeaseState | null | undefined, candidateSeatId: string) => {
  if (!candidateSeatId) return false;
  return state?.autoPlayBySeatId?.[candidateSeatId] !== true
    && (state?.gameSeats ?? []).some((seat) => seat.id === candidateSeatId && isEligibleGameCoordinatorSeat(seat));
};

export const isGameCoordinatorLeaseActive = (state: GameCoordinatorLeaseState | null | undefined, now = Date.now()) => {
  const lease = getGameCoordinatorLeaseSnapshot(state);
  return Boolean(
    lease.coordinatorSeatId
    && lease.coordinatorEpoch > 0
    && lease.coordinatorLeaseExpiresAt > now
    && isGameCoordinatorCandidateEligible(state, lease.coordinatorSeatId),
  );
};

export const matchesActiveGameCoordinatorLease = (
  state: GameCoordinatorLeaseState | null | undefined,
  token: GameCoordinatorLeaseToken | null | undefined,
  now = Date.now(),
) => {
  if (!token || !isGameCoordinatorLeaseActive(state, now)) return false;
  const lease = getGameCoordinatorLeaseSnapshot(state);
  return token.coordinatorSeatId === lease.coordinatorSeatId
    && normalizeCoordinatorEpoch(token.coordinatorEpoch) === lease.coordinatorEpoch;
};

export const decideGameCoordinatorLeaseClaim = (
  state: GameCoordinatorLeaseState | null | undefined,
  candidateSeatId: string,
  now = Date.now(),
  leaseMs = GAME_COORDINATOR_LEASE_MS,
): GameCoordinatorLeaseDecision => {
  const current = getGameCoordinatorLeaseSnapshot(state);
  if (!isGameCoordinatorCandidateEligible(state, candidateSeatId)) {
    return { status: 'ineligible', ...current };
  }

  const currentOwnerEligible = isGameCoordinatorCandidateEligible(state, current.coordinatorSeatId);
  const currentLeaseActive = Boolean(
    currentOwnerEligible
    && current.coordinatorEpoch > 0
    && current.coordinatorLeaseExpiresAt > now,
  );
  if (currentLeaseActive && current.coordinatorSeatId !== candidateSeatId) {
    return { status: 'held', ...current };
  }

  const renewing = currentLeaseActive && current.coordinatorSeatId === candidateSeatId;
  return {
    status: renewing ? 'renewed' : 'acquired',
    coordinatorSeatId: candidateSeatId,
    coordinatorEpoch: renewing ? current.coordinatorEpoch : Math.max(0, current.coordinatorEpoch) + 1,
    coordinatorLeaseExpiresAt: now + Math.max(1, leaseMs),
  };
};
