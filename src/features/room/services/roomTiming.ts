export const TURN_ACTION_TIMEOUT_MS = 10000;
export const TURN_ITEM_PROMPT_TIMEOUT_MS = 10000;
export const TURN_ACTION_TIMEOUT_STEP_MS = 5000;
export const TURN_ACTION_TIMEOUT_MIN_MS = 5000;
export const TURN_NETWORK_GRACE_MS = 1000;
export const TURN_END_HOLD_MS = 1000;
export const TURN_START_DELAY_MS = 1000;
export const TURN_TRANSITION_DELAY_MS = TURN_END_HOLD_MS + TURN_START_DELAY_MS;

export const normalizeTurnActionTimeoutCount = (count: unknown) => {
  const normalized = Number(count ?? 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return 0;
  return Math.min(2, Math.floor(normalized));
};

export const getTurnActionTimeoutMsForCount = (
  count: unknown,
  baseTimeoutMs = TURN_ACTION_TIMEOUT_MS,
) => Math.max(
  TURN_ACTION_TIMEOUT_MIN_MS,
  baseTimeoutMs - normalizeTurnActionTimeoutCount(count) * TURN_ACTION_TIMEOUT_STEP_MS,
);

export const incrementTurnActionTimeoutCount = (count: unknown) => Math.min(
  2,
  normalizeTurnActionTimeoutCount(count) + 1,
);

export const getTurnOrderIntroCompletionTiming = ({
  completedAt,
  turnOrderIds,
  turnIndex,
  turnActionTimeoutCountBySeatId,
}: {
  completedAt: number;
  turnOrderIds: unknown;
  turnIndex: unknown;
  turnActionTimeoutCountBySeatId?: Record<string, unknown> | null;
}) => {
  const normalizedCompletedAt = Number(completedAt);
  const ids = Array.isArray(turnOrderIds)
    ? turnOrderIds.filter((seatId): seatId is string => typeof seatId === 'string' && Boolean(seatId))
    : [];
  if (!Number.isFinite(normalizedCompletedAt) || normalizedCompletedAt <= 0 || ids.length === 0) {
    return { turnDeadlineAt: 0, turnDeadlineKind: '' as const };
  }
  const rawTurnIndex = Number(turnIndex ?? 0);
  const normalizedTurnIndex = Number.isFinite(rawTurnIndex) ? Math.floor(rawTurnIndex) : 0;
  const activeSeatId = ids[((normalizedTurnIndex % ids.length) + ids.length) % ids.length];
  return {
    turnDeadlineAt: normalizedCompletedAt + getTurnActionTimeoutMsForCount(turnActionTimeoutCountBySeatId?.[activeSeatId]),
    turnDeadlineKind: 'roll' as const,
  };
};

export const getTurnRecoveryDeadlineAt = (turnDeadlineAt: number) => turnDeadlineAt + TURN_NETWORK_GRACE_MS;