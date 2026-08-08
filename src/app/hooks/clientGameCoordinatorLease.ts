export type ClientGameCoordinatorLease = {
  coordinatorSeatId: string;
  coordinatorEpoch: number;
  coordinatorLeaseExpiresAt: unknown;
};

export type ClientGameCoordinatorLeaseContext = {
  roomId: string;
  screen: string;
  lease: ClientGameCoordinatorLease;
};

export type ClientGameCoordinatorLeaseRequestContext = {
  roomId: string;
  screen: string;
  candidateSeatId: string;
  eligible: boolean;
};

const getLeaseExpiryMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value instanceof Date) return value.getTime();
  const millis = Number(value ?? 0);
  return Number.isFinite(millis) ? millis : 0;
};

const getLeaseEpoch = (value: unknown) => {
  const epoch = Number(value ?? 0);
  return Number.isFinite(epoch) && epoch > 0 ? Math.floor(epoch) : 0;
};

export const isEmptyClientGameCoordinatorLease = (lease: ClientGameCoordinatorLease) => Boolean(
  !lease.coordinatorSeatId
  && getLeaseEpoch(lease.coordinatorEpoch) === 0
  && getLeaseExpiryMillis(lease.coordinatorLeaseExpiresAt) <= 0,
);

export const isCompleteClientGameCoordinatorLease = (lease: ClientGameCoordinatorLease) => Boolean(
  lease.coordinatorSeatId
  && getLeaseEpoch(lease.coordinatorEpoch) > 0
  && getLeaseExpiryMillis(lease.coordinatorLeaseExpiresAt) > 0,
);

export const isCurrentClientGameCoordinatorLeaseRequest = (
  request: ClientGameCoordinatorLeaseRequestContext,
  current: ClientGameCoordinatorLeaseRequestContext,
) => Boolean(
  request.roomId
  && request.eligible
  && request.roomId === current.roomId
  && request.screen === 'game'
  && current.screen === 'game'
  && request.candidateSeatId
  && request.candidateSeatId === current.candidateSeatId
  && current.eligible
);

export const shouldApplyDisposedClientGameCoordinatorLeaseResult = (
  current: ClientGameCoordinatorLease,
  result: ClientGameCoordinatorLease,
) => {
  if (!isCompleteClientGameCoordinatorLease(result)) return false;
  const currentEpoch = getLeaseEpoch(current.coordinatorEpoch);
  const resultEpoch = getLeaseEpoch(result.coordinatorEpoch);
  if (resultEpoch !== currentEpoch) return resultEpoch > currentEpoch;
  if (current.coordinatorSeatId && result.coordinatorSeatId !== current.coordinatorSeatId) return false;
  return getLeaseExpiryMillis(result.coordinatorLeaseExpiresAt) >= getLeaseExpiryMillis(current.coordinatorLeaseExpiresAt);
};

export const stabilizeClientGameCoordinatorLease = (
  previous: ClientGameCoordinatorLeaseContext,
  next: ClientGameCoordinatorLeaseContext,
): ClientGameCoordinatorLeaseContext => {
  const sameActiveGame = Boolean(
    next.roomId
    && previous.roomId === next.roomId
    && previous.screen === 'game'
    && next.screen === 'game',
  );
  if (
    sameActiveGame
    && !isCompleteClientGameCoordinatorLease(next.lease)
    && isCompleteClientGameCoordinatorLease(previous.lease)
  ) {
    return { ...next, lease: previous.lease };
  }
  return next;
};
