type TurnActionLike = {
  type: string;
  payload?: Record<string, unknown>;
};

const DEADLINE_ACTION_TYPES = new Set([
  'roll_yut',
  'move_piece',
  'use_item',
  'place_trap',
  'item_pickup_decision',
]);

const isRecoveryOrAutomatedPayload = (payload: Record<string, unknown>) => Boolean(
  payload.completeFallPresentation === true
  || payload.timedOut === true
  || payload.recoveredByCoordinator === true
  || payload.itemPromptTimeoutRecovery === true
  || payload.itemPickupTimeoutRecovery === true
  || payload.trapPlacementTimeoutRecovery === true
  || payload.timeoutRecoveredBy !== undefined
  || payload.timeoutDeadlineAt !== undefined
  || payload.coordinatorSeatId !== undefined
);

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
  if (!shouldAttachClientActionStartedAt(action)) return action;
  return {
    ...action,
    payload: {
      ...action.payload,
      clientActionStartedAt: startedAt,
    },
  };
};
