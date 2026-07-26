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

const getLeaseExpiryMillis = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (value instanceof Date) return value.getTime();
  const millis = Number(value ?? 0);
  return Number.isFinite(millis) ? millis : 0;
};

export const isEmptyClientGameCoordinatorLease = (lease: ClientGameCoordinatorLease) => Boolean(
  !lease.coordinatorSeatId
  && !(Number.isFinite(Number(lease.coordinatorEpoch)) && Number(lease.coordinatorEpoch) > 0)
  && getLeaseExpiryMillis(lease.coordinatorLeaseExpiresAt) <= 0,
);

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
    && isEmptyClientGameCoordinatorLease(next.lease)
    && !isEmptyClientGameCoordinatorLease(previous.lease)
  ) {
    return { ...next, lease: previous.lease };
  }
  return next;
};
