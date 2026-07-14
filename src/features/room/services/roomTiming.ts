export const TURN_ACTION_TIMEOUT_MS = 15000;
export const TURN_ITEM_PROMPT_TIMEOUT_MS = 10000;
export const TURN_ACTION_TIMEOUT_STEP_MS = 5000;
export const TURN_ACTION_TIMEOUT_MIN_MS = 5000;
export const TURN_NETWORK_GRACE_MS = 1000;

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

export const getTurnRecoveryDeadlineAt = (turnDeadlineAt: number) => turnDeadlineAt + TURN_NETWORK_GRACE_MS;
