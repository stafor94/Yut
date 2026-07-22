type TurnActionLike = {
  type: string;
  actorId?: string;
  payload?: Record<string, unknown>;
};

type DeadlineAutoActionMarker = {
  actionType: string;
  actorId: string;
  deadlineAt: number;
  expiresAt: number;
};

const DEADLINE_ACTION_TYPES = new Set([
  'roll_yut',
  'move_piece',
  'use_item',
  'place_trap',
  'item_pickup_decision',
]);

const AI_ACTION_ID_PREFIXES = [
  'roll_yut_ai',
  'move_piece_ai',
  'use_item_ai',
  'place_trap_ai',
  'item_pickup_ai',
];

const DEADLINE_AUTO_ACTION_MARKER_TTL_MS = 1_500;
let nextDeadlineAutoAction: DeadlineAutoActionMarker | null = null;

const isRecoveryOrAutomatedPayload = (payload: Record<string, unknown>) => {
  const clientActionId = typeof payload.clientActionId === 'string' ? payload.clientActionId : '';
  return Boolean(
    payload.completeFallPresentation === true
    || payload.timedOut === true
    || payload.recoveredByCoordinator === true
    || payload.itemPromptTimeoutRecovery === true
    || payload.itemPickupTimeoutRecovery === true
    || payload.trapPlacementTimeoutRecovery === true
    || payload.timeoutRecoveredBy !== undefined
    || payload.timeoutDeadlineAt !== undefined
    || payload.coordinatorSeatId !== undefined
    || AI_ACTION_ID_PREFIXES.some((prefix) => clientActionId.startsWith(prefix))
  );
};

export const markNextDeadlineAutoAction = ({
  actionType,
  actorId = '',
  deadlineAt,
  now = Date.now(),
}: {
  actionType: string;
  actorId?: string;
  deadlineAt: number;
  now?: number;
}) => {
  if (!DEADLINE_ACTION_TYPES.has(actionType) || !Number.isFinite(deadlineAt) || deadlineAt <= now) {
    nextDeadlineAutoAction = null;
    return false;
  }
  nextDeadlineAutoAction = {
    actionType,
    actorId,
    deadlineAt,
    expiresAt: now + DEADLINE_AUTO_ACTION_MARKER_TTL_MS,
  };
  return true;
};

export const clearNextDeadlineAutoAction = () => {
  nextDeadlineAutoAction = null;
};

const consumeDeadlineAutoAction = (action: TurnActionLike, now: number) => {
  const marker = nextDeadlineAutoAction;
  if (!marker) return null;
  if (marker.expiresAt < now) {
    nextDeadlineAutoAction = null;
    return null;
  }
  const actorMatches = !marker.actorId || marker.actorId === action.actorId;
  const actionMatches = marker.actionType === action.type;
  nextDeadlineAutoAction = null;
  return actionMatches && actorMatches ? marker : null;
};

export const shouldAttachClientActionStartedAt = (action: TurnActionLike) => {
  if (!DEADLINE_ACTION_TYPES.has(action.type)) return false;
  const payload = action.payload;
  if (!payload || isRecoveryOrAutomatedPayload(payload)) return false;
  const clientActionId = payload.clientActionId;
  if (typeof clientActionId !== 'string' || !clientActionId) return false;
  const existingStartedAt = Number(payload.clientActionStartedAt ?? 0);
  return !Number.isFinite(existingStartedAt) || existingStartedAt <= 0;
};

export const attachClientActionStartedAt = <T extends TurnActionLike>(action: T, startedAt = Date.now()): T => {
  const payload = action.payload;
  if (!payload || isRecoveryOrAutomatedPayload(payload)) return action;
  const autoMarker = consumeDeadlineAutoAction(action, startedAt);
  const attachStartedAt = shouldAttachClientActionStartedAt(action);
  if (!attachStartedAt && !autoMarker) return action;
  const existingStartedAt = Number(payload.clientActionStartedAt ?? 0);
  return {
    ...action,
    payload: {
      ...payload,
      clientActionStartedAt: Number.isFinite(existingStartedAt) && existingStartedAt > 0 ? existingStartedAt : startedAt,
      ...(autoMarker ? {
        deadlineAutoSubmitted: true,
        autoSubmittedDeadlineAt: autoMarker.deadlineAt,
      } : {}),
    },
  } as T;
};
