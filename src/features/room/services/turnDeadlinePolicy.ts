export type TurnDeadlineKind = 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
export type TurnActionPhase = 'roll' | 'move';

const VALID_TURN_DEADLINE_KINDS = new Set<TurnDeadlineKind>([
  'roll',
  'move',
  'turn_order',
  'item_prompt',
  'trap_placement',
  '',
]);

export const normalizeTurnDeadlineAt = (value: unknown) => {
  const deadlineAt = Number(value ?? 0);
  return Number.isFinite(deadlineAt) && deadlineAt > 0 ? deadlineAt : 0;
};

export const normalizeTurnDeadlineKind = (value: unknown): TurnDeadlineKind => (
  typeof value === 'string' && VALID_TURN_DEADLINE_KINDS.has(value as TurnDeadlineKind)
    ? value as TurnDeadlineKind
    : ''
);

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

export const isManualTurnActionDeadlineExpired = ({
  deadlineAt,
  deadlineKind,
  expectedKind,
  clientActionId,
  now = Date.now(),
  networkGraceMs = 0,
}: {
  deadlineAt: unknown;
  deadlineKind: unknown;
  expectedKind: TurnActionPhase;
  clientActionId: unknown;
  now?: number;
  networkGraceMs?: number;
}) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  if (!normalizedDeadlineAt || normalizeTurnDeadlineKind(deadlineKind) !== expectedKind) return false;

  const startedAt = getClientActionStartedAt(clientActionId);
  if (startedAt >= normalizedDeadlineAt) return true;
  if (!startedAt && now >= normalizedDeadlineAt) return true;
  return now >= normalizedDeadlineAt + Math.max(0, networkGraceMs);
};
