type CommittableGameAction = {
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
};

type AuthoritativeMoveStateIdentity = {
  lastSequence?: unknown;
  turnIndex?: unknown;
  turnDeadlineAt?: unknown;
  turnDeadlineKind?: unknown;
};

type ManualMoveReservationData = {
  reservationType?: unknown;
  processed?: unknown;
  actorId?: unknown;
  clientActionId?: unknown;
  clientActionStartedAt?: unknown;
  expectedPreviousSequence?: unknown;
  expectedTurnIndex?: unknown;
  expiresAt?: unknown;
  createdAt?: unknown;
};

export type TrustedManualMoveReservationContext = {
  actorId: string;
  clientActionId: string;
  clientActionStartedAt: number;
  expectedPreviousSequence: number;
  expectedTurnIndex: number;
  deadlineAt: number;
  serverReceivedAt: number;
  expiresAt: number;
};

const TRUSTED_MANUAL_MOVE_RESERVATION = Symbol('trusted-manual-move-reservation');
const MANUAL_MOVE_RESERVATION_READ_SENTINEL = -1;
const pendingTrustedManualMoveReservations = new Map<string, TrustedManualMoveReservationContext>();
type TrustedManualMoveAction = CommittableGameAction & {
  [TRUSTED_MANUAL_MOVE_RESERVATION]?: TrustedManualMoveReservationContext;
};

export const MANUAL_MOVE_RESERVATION_TTL_MS = 30_000;
export const MOVE_RESERVATION_REEVALUATE_REASON = 'authoritative sequence가 변경되어 최신 상태 재평가가 필요합니다.';

export const getClientActionId = (action: CommittableGameAction) => (
  typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : ''
);

export const getManualMoveReservationKey = (roomId: string, actorId: string) => (
  `manual_move_reservation:v1:${roomId}:${actorId}`
);

export const isManualPlayerMove = (action: CommittableGameAction) => {
  const clientActionId = getClientActionId(action);
  return action.type === 'move_piece'
    && Boolean(action.actorId)
    && clientActionId.startsWith(`move_piece:${action.actorId}:`)
    && action.payload?.recoveredByCoordinator !== true
    && action.payload?.deadlineAutoSubmitted !== true
    && typeof action.payload?.automationSource !== 'string'
    && typeof action.payload?.coordinatorSeatId !== 'string';
};

export const getManualMoveActionIdentity = (action: CommittableGameAction) => {
  if (!isManualPlayerMove(action)) return null;
  const clientActionId = getClientActionId(action);
  const prefix = `move_piece:${action.actorId}:`;
  const [sequenceText = '', turnIndexText = ''] = clientActionId.slice(prefix.length).split(':', 2);
  if (!/^\d+$/.test(sequenceText) || !/^\d+$/.test(turnIndexText)) return null;
  const expectedPreviousSequence = Number(sequenceText);
  const expectedTurnIndex = Number(turnIndexText);
  if (!Number.isSafeInteger(expectedPreviousSequence) || !Number.isSafeInteger(expectedTurnIndex)) return null;
  return { expectedPreviousSequence, expectedTurnIndex };
};

const getServerTimestampMillis = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('toMillis' in value)) return 0;
  const toMillis = value.toMillis;
  if (typeof toMillis !== 'function') return 0;
  const millis = Number(toMillis.call(value));
  return Number.isFinite(millis) && millis > 0 ? millis : 0;
};

const getReservationLifetime = (reservation: ManualMoveReservationData) => {
  const serverReceivedAt = getServerTimestampMillis(reservation.createdAt);
  return {
    serverReceivedAt,
    expiresAt: serverReceivedAt ? serverReceivedAt + MANUAL_MOVE_RESERVATION_TTL_MS : 0,
  };
};

const getTrustedReservationFromStoredData = ({
  reservation,
  actorId,
  state,
  now,
}: {
  reservation: ManualMoveReservationData;
  actorId: string;
  state: AuthoritativeMoveStateIdentity;
  now: number;
}): TrustedManualMoveReservationContext | null => {
  const clientActionId = String(reservation.clientActionId ?? '');
  const clientActionStartedAt = Number(reservation.clientActionStartedAt ?? 0);
  const expectedPreviousSequence = Number(reservation.expectedPreviousSequence ?? -1);
  const expectedTurnIndex = Number(reservation.expectedTurnIndex ?? -1);
  const stateSequence = Number(state.lastSequence ?? 0);
  const stateTurnIndex = Number(state.turnIndex ?? -1);
  const deadlineAt = Number(state.turnDeadlineAt ?? 0);
  const { serverReceivedAt, expiresAt } = getReservationLifetime(reservation);

  if (reservation.reservationType !== 'manual_move'
    || reservation.processed !== true
    || String(reservation.actorId ?? '') !== actorId
    || !clientActionId.startsWith(`move_piece:${actorId}:`)
    || !Number.isFinite(clientActionStartedAt)
    || clientActionStartedAt <= 0
    || !Number.isSafeInteger(expectedPreviousSequence)
    || expectedPreviousSequence !== stateSequence
    || !Number.isSafeInteger(expectedTurnIndex)
    || expectedTurnIndex !== stateTurnIndex
    || state.turnDeadlineKind !== 'move'
    || !Number.isFinite(deadlineAt)
    || deadlineAt <= 0
    || clientActionStartedAt > deadlineAt
    || serverReceivedAt <= 0
    || serverReceivedAt > deadlineAt
    || expiresAt <= now) return null;

  return {
    actorId,
    clientActionId,
    clientActionStartedAt,
    expectedPreviousSequence,
    expectedTurnIndex,
    deadlineAt,
    serverReceivedAt,
    expiresAt,
  };
};

export const getCoordinatorTimeoutDeadlineAt = (action: CommittableGameAction) => {
  if (action.type !== 'move_piece') return 0;
  const deadlineAt = Number(action.payload?.timeoutDeadlineAt ?? 0);
  const coordinatorRecovery = action.payload?.recoveredByCoordinator === true
    || typeof action.payload?.timeoutRecoveredBy === 'string';
  if (coordinatorRecovery && Number.isFinite(deadlineAt) && deadlineAt > 0) return Math.trunc(deadlineAt);
  return getManualMoveActionIdentity(action) ? MANUAL_MOVE_RESERVATION_READ_SENTINEL : 0;
};

export const isActiveManualMoveReservation = ({
  reservation,
  actorId,
  timeoutDeadlineAt,
  state,
  now,
}: {
  reservation: ManualMoveReservationData;
  actorId: string;
  timeoutDeadlineAt: number;
  state: AuthoritativeMoveStateIdentity;
  now: number;
}) => {
  const trustedReservation = getTrustedReservationFromStoredData({ reservation, actorId, state, now });
  if (timeoutDeadlineAt === MANUAL_MOVE_RESERVATION_READ_SENTINEL) {
    if (trustedReservation) {
      pendingTrustedManualMoveReservations.set(trustedReservation.clientActionId, trustedReservation);
    }
    return false;
  }
  return Boolean(trustedReservation && trustedReservation.deadlineAt === timeoutDeadlineAt);
};

export const getTrustedManualMoveReservationContext = ({
  reservation,
  action,
  state,
  now,
}: {
  reservation: ManualMoveReservationData;
  action: CommittableGameAction;
  state: AuthoritativeMoveStateIdentity;
  now: number;
}): TrustedManualMoveReservationContext | null => {
  const actionIdentity = getManualMoveActionIdentity(action);
  const trustedReservation = getTrustedReservationFromStoredData({
    reservation,
    actorId: action.actorId,
    state,
    now,
  });
  if (!actionIdentity || !trustedReservation) return null;

  const clientActionId = getClientActionId(action);
  const clientActionStartedAt = Number(action.payload?.clientActionStartedAt ?? 0);
  return trustedReservation.clientActionId === clientActionId
    && trustedReservation.clientActionStartedAt === clientActionStartedAt
    && trustedReservation.expectedPreviousSequence === actionIdentity.expectedPreviousSequence
    && trustedReservation.expectedTurnIndex === actionIdentity.expectedTurnIndex
    ? trustedReservation
    : null;
};

export const attachTrustedManualMoveReservationContext = <TAction extends CommittableGameAction>(
  action: TAction,
  context: TrustedManualMoveReservationContext,
): TAction => {
  const trustedAction = {
    ...action,
    ...(action.payload ? { payload: { ...action.payload } } : {}),
  } as TAction & TrustedManualMoveAction;
  Object.defineProperty(trustedAction, TRUSTED_MANUAL_MOVE_RESERVATION, {
    value: context,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return trustedAction;
};

export const getTrustedManualMoveReservationContextFromAction = (
  action: CommittableGameAction,
): TrustedManualMoveReservationContext | null => {
  const attachedContext = (action as TrustedManualMoveAction)[TRUSTED_MANUAL_MOVE_RESERVATION];
  if (attachedContext) return attachedContext;
  const clientActionId = getClientActionId(action);
  if (!clientActionId) return null;
  const pendingContext = pendingTrustedManualMoveReservations.get(clientActionId) ?? null;
  pendingTrustedManualMoveReservations.delete(clientActionId);
  return pendingContext;
};
