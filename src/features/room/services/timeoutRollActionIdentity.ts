import type { RollTimingZone, YutResult } from '../../../game-core/roll';
import {
  ROLL_TIMEOUT_RESOLVER_VERSION,
  makeTimeoutActionKey,
  resolveRollTimeoutAction,
} from './timeoutResolvers';

type TimeoutRollPayload = Record<string, unknown> & {
  clientActionId?: unknown;
  timedOut?: unknown;
  timeoutDeadlineAt?: unknown;
  deadlineAutoSubmitted?: unknown;
  autoSubmittedDeadlineAt?: unknown;
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

const MAX_MUTATION_ALIASES_PER_ROOM = 32;
const baselineMathRandom = Math.random;
const mutationAliasesByRoom = new Map<string, Map<string, string>>();
const pendingTimeoutRollCandidatesByRoom = new Map<string, Map<string, string>>();

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

/**
 * GameBoardControls temporarily replaces Math.random only while the timeout roll
 * callback creates its local result and pending key. Capture that key before an
 * optional QA/network delay so a coordinator-first snapshot is still an echo.
 */
export const registerPendingTimeoutRollCandidate = (
  roomId: string,
  localClientMutationId: string,
  actorId: string,
) => {
  if (Math.random === baselineMathRandom || !roomId || !localClientMutationId || !actorId) return false;
  const candidates = pendingTimeoutRollCandidatesByRoom.get(roomId) ?? new Map<string, string>();
  candidates.set(localClientMutationId, actorId);
  while (candidates.size > 2) {
    const oldestKey = candidates.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    candidates.delete(oldestKey);
  }
  pendingTimeoutRollCandidatesByRoom.set(roomId, candidates);
  return true;
};

/** A matching timeout roll may race the coordinator because both use one canonical action key. */
export const hasPendingTimeoutRollCandidate = (roomId: string, actorId: string) => {
  if (!roomId || !actorId) return false;
  const candidates = pendingTimeoutRollCandidatesByRoom.get(roomId);
  if (!candidates) return false;
  for (const candidateActorId of candidates.values()) {
    if (candidateActorId === actorId) return true;
  }
  return false;
};

export const removePendingTimeoutRollCandidate = (roomId: string, localClientMutationId: string) => {
  const candidates = pendingTimeoutRollCandidatesByRoom.get(roomId);
  if (!candidates) return;
  candidates.delete(localClientMutationId);
  if (!candidates.size) pendingTimeoutRollCandidatesByRoom.delete(roomId);
};

const findPendingTimeoutRollAlias = (roomId: string, canonicalId: string) => {
  if (!canonicalId.startsWith('timeout:')) return '';
  const candidates = pendingTimeoutRollCandidatesByRoom.get(roomId);
  if (!candidates?.size) return '';
  const entries = [...candidates.entries()];
  if (entries.length === 1) return entries[0][0];
  const actorMatch = entries.find(([, actorId]) => canonicalId.includes(`:roll:${actorId}:`));
  return actorMatch?.[0] ?? '';
};

export const getTimeoutRollMutationAlias = (roomId: string, clientMutationId: unknown) => {
  if (typeof clientMutationId !== 'string' || !clientMutationId) return clientMutationId;
  const explicitAlias = mutationAliasesByRoom.get(roomId)?.get(clientMutationId);
  if (explicitAlias) return explicitAlias;
  const pendingAlias = findPendingTimeoutRollAlias(roomId, clientMutationId);
  if (pendingAlias) {
    rememberMutationAlias(roomId, clientMutationId, pendingAlias);
    return pendingAlias;
  }
  return clientMutationId;
};

export const clearTimeoutRollMutationAliases = (roomId: string) => {
  if (!roomId) return;
  mutationAliasesByRoom.delete(roomId);
  pendingTimeoutRollCandidatesByRoom.delete(roomId);
};

/**
 * Keeps the deadline-leading UI move local identity for its optimistic presentation,
 * but submits the same deterministic identity used by stalled/coordinator recovery.
 */
export const canonicalizeTimeoutMoveAction = <TAction,>(roomId: string, action: TAction): TAction => {
  if (!action || typeof action !== 'object') return action;
  const candidate = action as unknown as TimeoutRollAction;
  const payload = candidate.payload;
  const timeoutDeadlineAt = Math.trunc(Number(payload?.autoSubmittedDeadlineAt ?? 0));
  if (
    candidate.type !== 'move_piece'
    || typeof candidate.actorId !== 'string'
    || !candidate.actorId
    || payload?.deadlineAutoSubmitted !== true
    || !Number.isFinite(timeoutDeadlineAt)
    || timeoutDeadlineAt <= 0
  ) return action;

  const canonicalClientActionId = makeTimeoutActionKey({
    roomId,
    stage: 'move',
    actorId: candidate.actorId,
    timeoutDeadlineAt,
  });
  const localClientActionId = typeof payload.clientActionId === 'string' ? payload.clientActionId.trim() : '';
  rememberMutationAlias(roomId, canonicalClientActionId, localClientActionId);

  return {
    ...candidate,
    payload: {
      ...payload,
      clientActionId: canonicalClientActionId,
      timeoutDeadlineAt,
    },
  } as unknown as TAction;
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
  const suppliedStartedAt = Number(payload.clientActionStartedAt ?? 0);
  const deadlineAutoStartedAt = Number.isFinite(suppliedStartedAt) && suppliedStartedAt > 0
    ? Math.min(suppliedStartedAt, Math.max(1, timeoutDeadlineAt - 1))
    : Math.max(1, timeoutDeadlineAt - 1);
  return {
    ...action,
    payload: {
      ...(isImmediateClientRequest ? basePayload : payload),
      resolvedTimeoutDeadlineAt: timeoutDeadlineAt,
      deadlineAutoSubmitted: true,
      autoSubmittedDeadlineAt: timeoutDeadlineAt,
      clientActionStartedAt: deadlineAutoStartedAt,
      timeoutInitialPositionPercent: resolution.initialPositionPercent,
      timeoutInitialDirection: resolution.initialDirection,
      timingPositionPercent: resolution.timingPositionPercent,
      rollTimingZone: resolution.rollTimingZone,
      clientRollResult: resolution.clientRollResult,
      clientRollSticks: resolution.sticks,
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
    let changed = false;
    value.forEach((entry) => {
      const aliasedEntry = aliasMutationIdsDeep(roomId, entry, seen);
      next.push(aliasedEntry);
      if (aliasedEntry !== entry) changed = true;
    });
    if (!changed) {
      seen.set(value, value);
      return value;
    }
    return next;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  seen.set(value, next);
  let changed = false;
  Object.entries(source).forEach(([key, entry]) => {
    const aliasedEntry = key === 'clientMutationId' || key === 'lastClientMutationId' || key === 'clientActionId'
      ? getTimeoutRollMutationAlias(roomId, entry)
      : aliasMutationIdsDeep(roomId, entry, seen);
    next[key] = aliasedEntry;
    if (aliasedEntry !== entry) changed = true;
  });
  if (!changed) {
    seen.set(value, value);
    return value;
  }
  return next;
};

/** Preserve the local pending-animation identity when the canonical Firestore echo returns. */
export const aliasTimeoutRollMutationIds = <T>(roomId: string, value: T): T => (
  aliasMutationIdsDeep(roomId, value, new WeakMap<object, unknown>()) as T
);
