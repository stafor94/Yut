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
};

export const MANUAL_MOVE_RESERVATION_TTL_MS = 10_000;
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
  const expectedPreviousSequence = Number(sequenceText);
  const expectedTurnIndex = Number(turnIndexText);
  if (!Number.isInteger(expectedPreviousSequence) || expectedPreviousSequence < 0) return null;
  if (!Number.isInteger(expectedTurnIndex) || expectedTurnIndex < 0) return null;
  return { expectedPreviousSequence, expectedTurnIndex };
};

export const getCoordinatorTimeoutDeadlineAt = (action: CommittableGameAction) => {
  if (action.type !== 'move_piece') return 0;
  const deadlineAt = Number(action.payload?.timeoutDeadlineAt ?? 0);
  const coordinatorRecovery = action.payload?.recoveredByCoordinator === true
    || typeof action.payload?.timeoutRecoveredBy === 'string';
  return coordinatorRecovery && Number.isFinite(deadlineAt) && deadlineAt > 0
    ? Math.trunc(deadlineAt)
    : 0;
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
  const clientActionId = String(reservation.clientActionId ?? '');
  const clientActionStartedAt = Number(reservation.clientActionStartedAt ?? 0);
  const expectedPreviousSequence = Number(reservation.expectedPreviousSequence ?? -1);
  const expectedTurnIndex = Number(reservation.expectedTurnIndex ?? -1);
  const expiresAt = Number(reservation.expiresAt ?? 0);
  const stateSequence = Number(state.lastSequence ?? 0);
  const stateTurnIndex = Number(state.turnIndex ?? -1);
  const stateDeadlineAt = Number(state.turnDeadlineAt ?? 0);

  return reservation.reservationType === 'manual_move'
    && reservation.processed === true
    && String(reservation.actorId ?? '') === actorId
    && clientActionId.startsWith(`move_piece:${actorId}:`)
    && Number.isFinite(clientActionStartedAt)
    && clientActionStartedAt > 0
    && clientActionStartedAt <= timeoutDeadlineAt
    && Number.isInteger(expectedPreviousSequence)
    && expectedPreviousSequence === stateSequence
    && Number.isInteger(expectedTurnIndex)
    && expectedTurnIndex === stateTurnIndex
    && state.turnDeadlineKind === 'move'
    && stateDeadlineAt === timeoutDeadlineAt
    && Number.isFinite(expiresAt)
    && expiresAt > now;
};
