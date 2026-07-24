export type TurnDeadlineKind = 'roll' | 'move' | 'item_prompt' | 'trap_placement' | '';
export type TurnActionPhase = Exclude<TurnDeadlineKind, ''>;
export type TurnTransitionPhase = 'ending' | 'starting' | 'ready';
export type MissingActionStartedAtPolicy = 'allow' | 'reject-after-grace';

const VALID_TURN_DEADLINE_KINDS = new Set<TurnDeadlineKind>([
  'roll',
  'move',
  'item_prompt',
  'trap_placement',
  '',
]);

// Date.now() values after 2000-01-01. Smaller numeric action-id tokens are
// sequences, turn indexes, or fixture values rather than trustworthy epochs.
const MIN_PLAUSIBLE_CLIENT_ACTION_EPOCH_MS = 946_684_800_000;

export const normalizeTurnDeadlineAt = (value: unknown) => {
  const deadlineAt = Number(value ?? 0);
  return Number.isFinite(deadlineAt) && deadlineAt > 0 ? deadlineAt : 0;
};

const normalizeDurationMs = (value: unknown) => {
  const durationMs = Number(value ?? 0);
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
};

export const normalizeTurnDeadlineKind = (value: unknown): TurnDeadlineKind => (
  typeof value === 'string' && VALID_TURN_DEADLINE_KINDS.has(value as TurnDeadlineKind)
    ? value as TurnDeadlineKind
    : ''
);

export const getTurnActionReadyAt = ({
  deadlineAt,
  durationMs,
}: {
  deadlineAt: unknown;
  durationMs: unknown;
}) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  const normalizedDurationMs = normalizeDurationMs(durationMs);
  return normalizedDeadlineAt && normalizedDurationMs
    ? Math.max(0, normalizedDeadlineAt - normalizedDurationMs)
    : 0;
};

export const getTurnDisplayAt = ({
  deadlineAt,
  durationMs,
  startDelayMs,
}: {
  deadlineAt: unknown;
  durationMs: unknown;
  startDelayMs: unknown;
}) => {
  const readyAt = getTurnActionReadyAt({ deadlineAt, durationMs });
  const normalizedStartDelayMs = normalizeDurationMs(startDelayMs);
  return readyAt ? Math.max(0, readyAt - normalizedStartDelayMs) : 0;
};

export const getTurnTransitionPhase = ({
  deadlineAt,
  durationMs,
  startDelayMs,
  now = Date.now(),
}: {
  deadlineAt: unknown;
  durationMs: unknown;
  startDelayMs: unknown;
  now?: number;
}): TurnTransitionPhase => {
  const readyAt = getTurnActionReadyAt({ deadlineAt, durationMs });
  if (!readyAt || now >= readyAt) return 'ready';
  const displayAt = getTurnDisplayAt({ deadlineAt, durationMs, startDelayMs });
  return displayAt && now < displayAt ? 'ending' : 'starting';
};

export const getDeadlineTimerAnimationState = ({
  deadlineAt,
  durationMs,
  now = Date.now(),
}: {
  deadlineAt: unknown;
  durationMs: unknown;
  now?: number;
}) => {
  const normalizedDurationMs = normalizeDurationMs(durationMs);
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  const remainingMs = normalizedDeadlineAt
    ? Math.max(0, Math.min(normalizedDurationMs, normalizedDeadlineAt - now))
    : normalizedDurationMs;
  return {
    durationMs: normalizedDurationMs,
    remainingMs,
    delayMs: remainingMs - normalizedDurationMs,
  };
};

export const isTurnActionDeadlineExpired = ({
  deadlineAt,
  deadlineKind,
  phase,
  now = Date.now(),
}: {
  deadlineAt: unknown;
  deadlineKind: unknown;
  phase: TurnActionPhase;
  now?: number;
}) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  return Boolean(
    normalizedDeadlineAt
    && normalizeTurnDeadlineKind(deadlineKind) === phase
    && now >= normalizedDeadlineAt
  );
};

export const getTurnActionDeadlineDelayMs = ({
  deadlineAt,
  deadlineKind,
  phase,
  fallbackMs,
  now = Date.now(),
}: {
  deadlineAt: unknown;
  deadlineKind: unknown;
  phase: TurnActionPhase;
  fallbackMs: number;
  now?: number;
}) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  if (!normalizedDeadlineAt || normalizeTurnDeadlineKind(deadlineKind) !== phase) {
    return Math.max(0, fallbackMs);
  }
  return Math.max(0, normalizedDeadlineAt - now);
};

export const getClientActionStartedAt = (clientActionId: unknown) => {
  if (typeof clientActionId !== 'string') return 0;
  const parts = clientActionId.split(':');
  if (parts.length < 2) return 0;
  const startedAt = Number(parts[parts.length - 2]);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
};

export const getTurnActionStartedAt = ({
  clientActionStartedAt,
  clientActionId,
}: {
  clientActionStartedAt?: unknown;
  clientActionId?: unknown;
}) => {
  const explicitStartedAt = Number(clientActionStartedAt ?? 0);
  if (Number.isFinite(explicitStartedAt) && explicitStartedAt > 0) return explicitStartedAt;
  const parsedStartedAt = getClientActionStartedAt(clientActionId);
  return parsedStartedAt >= MIN_PLAUSIBLE_CLIENT_ACTION_EPOCH_MS ? parsedStartedAt : 0;
};

export const isManualTurnActionDeadlineExpired = ({
  deadlineAt,
  deadlineKind,
  expectedKind,
  clientActionId,
  clientActionStartedAt,
  now = Date.now(),
  networkGraceMs = 0,
  missingStartedAtPolicy: _missingStartedAtPolicy = 'allow',
}: {
  deadlineAt: unknown;
  deadlineKind: unknown;
  expectedKind: TurnActionPhase;
  clientActionId?: unknown;
  clientActionStartedAt?: unknown;
  now?: number;
  networkGraceMs?: number;
  missingStartedAtPolicy?: MissingActionStartedAtPolicy;
}) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  if (!normalizedDeadlineAt || normalizeTurnDeadlineKind(deadlineKind) !== expectedKind) return false;

  const startedAt = getTurnActionStartedAt({ clientActionStartedAt, clientActionId });
  // Current clients always attach clientActionStartedAt at enqueue time. Missing
  // timestamps identify legacy/internal actions, which must continue through the
  // reducer's existing validation instead of being rejected by a deadline guard.
  if (!startedAt) return false;
  if (startedAt >= normalizedDeadlineAt) return true;
  return now >= normalizedDeadlineAt + Math.max(0, networkGraceMs);
};

export const getTurnDeadlineRemainingMs = (deadlineAt: unknown, now = Date.now()) => Math.max(0, normalizeTurnDeadlineAt(deadlineAt) - now);

export const hasTurnDeadlineExpired = (deadlineAt: unknown, now = Date.now()) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  return Boolean(normalizedDeadlineAt && now >= normalizedDeadlineAt);
};

export const isWithinTurnNetworkGrace = ({ startedAt, receivedAt = Date.now(), deadlineAt, networkGraceMs }: { startedAt: unknown; receivedAt?: number; deadlineAt: unknown; networkGraceMs: number }) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  const normalizedStartedAt = Number(startedAt ?? 0);
  if (!normalizedDeadlineAt || !Number.isFinite(normalizedStartedAt) || normalizedStartedAt <= 0) return false;
  return normalizedStartedAt < normalizedDeadlineAt && receivedAt < normalizedDeadlineAt + Math.max(0, networkGraceMs);
};
