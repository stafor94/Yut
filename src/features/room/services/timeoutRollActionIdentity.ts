import type { RollTimingZone, YutResult } from '../../../game-core/roll';
import {
  ROLL_TIMEOUT_RESOLVER_VERSION,
  resolveRollTimeoutAction,
} from './timeoutResolvers';

type TimeoutRollPayload = Record<string, unknown> & {
  clientActionId?: unknown;
  timedOut?: unknown;
  timeoutDeadlineAt?: unknown;
  timingPositionPercent?: unknown;
  rollTimingZone?: unknown;
  selectedGoldenYutResult?: unknown;
  clientRollResult?: unknown;
  clientFallOccurred?: unknown;
  clientFallCount?: unknown;
};

type TimeoutRollAction = {
  type: string;
  actorId: string;
  payload?: TimeoutRollPayload;
};

type PendingTimeoutRollRegistration = {
  timeoutDeadlineAt: number;
  stage: 'roll' | 'golden_yut';
};

const MAX_MUTATION_ALIASES_PER_ROOM = 32;
const mutationAliasesByRoom = new Map<string, Map<string, string>>();
let pendingTimeoutRollRegistration: PendingTimeoutRollRegistration | null = null;

const isRollTimingZone = (value: unknown): value is RollTimingZone => (
  value === 'perfect' || value === 'nice' || value === 'good' || value === 'normal' || value === 'bad'
);

const isYutResult = (value: unknown): value is YutResult => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<YutResult>;
  return typeof candidate.name === 'string' && Number.isFinite(candidate.steps);
};

const rememberMutationAlias = (roomId: string, canonicalId: string, localId: string) => {
  if (!roomId || !canonicalId || !localId || canonicalId === localId) return;
  const aliases = mutationAliasesByRoom.get(roomId) ?? new Map<string, string>();
  aliases.delete(canonicalId);
  aliases.set(canonicalId, localId);
  while (aliases.size > MAX_MUTATION_ALIASES_PER_ROOM) {
    const oldestKey = aliases.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    aliases.delete(oldestKey);
  }
  mutationAliasesByRoom.set(roomId, aliases);
};

/** Marks the synchronous App callback so its pending local key can be linked before network submission. */
export const runWithPendingTimeoutRollRegistration = <T>(
  timeoutDeadlineAt: number,
  operation: () => T,
  stage: PendingTimeoutRollRegistration['stage'] = 'roll',
): T => {
  const previousRegistration = pendingTimeoutRollRegistration;
  pendingTimeoutRollRegistration = { timeoutDeadlineAt: Math.trunc(timeoutDeadlineAt), stage };
  try {
    return operation();
  } finally {
    pendingTimeoutRollRegistration = previousRegistration;
  }
};

/**
 * App registers the local pending animation before its optional QA/network delay.
 * Link it to the canonical key now so a coordinator-first snapshot is still an echo.
 */
export const registerPendingTimeoutRollMutation = (
  roomId: string,
  localClientMutationId: string,
  actorId: string,
) => {
  const registration = pendingTimeoutRollRegistration;
  if (!registration || !roomId || !localClientMutationId || !actorId || registration.timeoutDeadlineAt <= 0) return false;
  const canonicalClientMutationId = resolveRollTimeoutAction({
    roomId,
    actorId,
    timeoutDeadlineAt: registration.timeoutDeadlineAt,
    stage: registration.stage,
  }).actionKey;
  rememberMutationAlias(roomId, canonicalClientMutationId, localClientMutationId);
  return true;
};

export const getTimeoutRollMutationAlias = (roomId: string, clientMutationId: unknown) => {
  if (typeof clientMutationId !== 'string' || !clientMutationId) return clientMutationId;
  return mutationAliasesByRoom.get(roomId)?.get(clientMutationId) ?? clientMutationId;
};

export const clearTimeoutRollMutationAliases = (roomId: string) => {
  if (roomId) mutationAliasesByRoom.delete(roomId);
};

/**
 * Replaces both the local timeout request and coordinator fallback with the same
 * action identity and complete deterministic roll payload before either reaches
 * the Firestore transaction.
 */
export const canonicalizeTimeoutRollAction = <TAction extends TimeoutRollAction>(
  roomId: string,
  action: TAction,
): TAction => {
  const payload = action.payload;
  const timeoutDeadlineAt = Math.trunc(Number(payload?.timeoutDeadlineAt ?? 0));
  if (action.type !== 'roll_yut' || payload?.timedOut !== true || timeoutDeadlineAt <= 0) return action;

  const selectedGoldenYutResult = isYutResult(payload.selectedGoldenYutResult)
    ? payload.selectedGoldenYutResult
    : null;
  const suppliedTimingPosition = Number(payload.timingPositionPercent);
  const suppliedTimingZone = isRollTimingZone(payload.rollTimingZone) ? payload.rollTimingZone : undefined;
  const resolution = resolveRollTimeoutAction({
    roomId,
    actorId: action.actorId,
    timeoutDeadlineAt,
    stage: selectedGoldenYutResult ? 'golden_yut' : 'roll',
    selectedGoldenYutResult,
    timingPositionPercent: Number.isFinite(suppliedTimingPosition) ? suppliedTimingPosition : undefined,
    rollTimingZone: suppliedTimingZone,
  });
  const originalClientActionId = typeof payload.clientActionId === 'string' ? payload.clientActionId : '';
  const isImmediateClientRequest = Boolean(originalClientActionId && !originalClientActionId.startsWith('timeout:'));
  rememberMutationAlias(roomId, resolution.actionKey, originalClientActionId);

  const suppliedResult = isYutResult(payload.clientRollResult) ? payload.clientRollResult : null;
  const suppliedFallOccurred = typeof payload.clientFallOccurred === 'boolean' ? payload.clientFallOccurred : null;
  const suppliedFallCount = Number.isInteger(payload.clientFallCount) ? Number(payload.clientFallCount) : null;
  if ((suppliedResult && suppliedResult.name !== resolution.clientRollResult.name)
    || (suppliedFallOccurred !== null && suppliedFallOccurred !== resolution.clientFallOccurred)
    || (suppliedFallCount !== null && suppliedFallCount !== resolution.clientFallCount)) {
    console.error('동일 timeout action의 로컬 payload가 canonical resolver 결과와 일치하지 않습니다.', {
      roomId,
      actorId: action.actorId,
      timeoutDeadlineAt,
      originalClientActionId,
      canonicalClientActionId: resolution.actionKey,
    });
  }

  const {
    timeoutDeadlineAt: _timeoutDeadlineAt,
    timeoutRecoveredBy: _timeoutRecoveredBy,
    ...basePayload
  } = payload;
  return {
    ...action,
    payload: {
      ...(isImmediateClientRequest ? basePayload : payload),
      resolvedTimeoutDeadlineAt: timeoutDeadlineAt,
      timingPositionPercent: resolution.timingPositionPercent,
      rollTimingZone: resolution.rollTimingZone,
      clientRollResult: resolution.clientRollResult,
      clientFallOccurred: resolution.clientFallOccurred,
      clientFallCount: resolution.clientFallCount,
      timeoutResolverVersion: ROLL_TIMEOUT_RESOLVER_VERSION,
      clientActionId: resolution.actionKey,
    },
  };
};

const aliasMutationIdsDeep = (roomId: string, value: unknown, seen: WeakMap<object, unknown>): unknown => {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(value, next);
    value.forEach((entry) => next.push(aliasMutationIdsDeep(roomId, entry, seen)));
    return next;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  seen.set(value, next);
  Object.entries(source).forEach(([key, entry]) => {
    next[key] = key === 'clientMutationId' || key === 'lastClientMutationId' || key === 'clientActionId'
      ? getTimeoutRollMutationAlias(roomId, entry)
      : aliasMutationIdsDeep(roomId, entry, seen);
  });
  return next;
};

/** Preserve the local pending-animation identity when the canonical Firestore echo returns. */
export const aliasTimeoutRollMutationIds = <T>(roomId: string, value: T): T => (
  aliasMutationIdsDeep(roomId, value, new WeakMap<object, unknown>()) as T
);
