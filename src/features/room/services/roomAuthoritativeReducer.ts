import { ITEM_DEFINITIONS, getAiItemValue, type ItemType } from '../../items/logic/items';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction as reduceCoreAuthoritativeGameAction,
} from './roomAuthoritativeReducerCore';
import {
  TURN_ACTION_TIMEOUT_MS,
  TURN_ITEM_PROMPT_TIMEOUT_MS,
  TURN_NETWORK_GRACE_MS,
  getTurnActionTimeoutMsForCount,
  incrementTurnActionTimeoutCount,
  normalizeTurnActionTimeoutCount,
} from './roomTiming';
import { isManualTurnActionDeadlineExpired } from './turnDeadlinePolicy';

export * from './roomAuthoritativeReducerCore';

type AuthoritativeArgs = Parameters<typeof reduceCoreAuthoritativeGameAction>;
type AuthoritativeReduction = ReturnType<typeof reduceCoreAuthoritativeGameAction>;

type PendingFallEffectShape = {
  id?: unknown;
  seatId?: unknown;
};

type AuthoritativeLogShape = {
  id?: unknown;
  text?: unknown;
};

export const FALL_PRESENTATION_GATE_MS = 3600;

const getPendingFallEffect = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const effect = value as PendingFallEffectShape;
  const seatId = typeof effect.seatId === 'string' ? effect.seatId : '';
  const id = typeof effect.id === 'number' && Number.isFinite(effect.id) ? effect.id : null;
  return seatId ? { id, seatId } : null;
};

const acknowledgeFallPresentationCompletion = (args: AuthoritativeArgs): AuthoritativeReduction | null => {
  const [state, action] = args;
  if (action.type !== 'roll_yut' || action.payload?.completeFallPresentation !== true) return null;

  const pendingEffect = getPendingFallEffect(state.fallEffect);
  if (pendingEffect && pendingEffect.seatId !== action.actorId) {
    return { status: 'rejected', reason: '낙 결과 표출을 완료할 권한이 없습니다.' };
  }

  // Presentation completion is deliberately client-local. The authoritative event stays immutable
  // until the next roll replaces fallEffect, so the fastest client can never erase a slower
  // client's pending animation or alter turn state.
  return { status: 'duplicate' };
};

const rejectRollBeforePresentationGateEnds = (args: AuthoritativeArgs): AuthoritativeReduction | null => {
  const [state, action] = args;
  if (action.type !== 'roll_yut' || action.payload?.completeFallPresentation === true) return null;
  const readyAt = Number(state.rollResultReadyAt ?? 0);
  if (!Number.isFinite(readyAt) || readyAt <= Date.now()) return null;
  return { status: 'rejected', reason: '이전 윷 결과 표출이 끝난 뒤 던질 수 있습니다.' };
};

const rejectExpiredManualRoll = (args: AuthoritativeArgs): AuthoritativeReduction | null => {
  const [state, action] = args;
  if (action.type !== 'roll_yut'
    || action.payload?.completeFallPresentation === true
    || action.payload?.timedOut === true
    || action.payload?.timeoutRecoveredBy !== undefined
    || action.payload?.timeoutDeadlineAt !== undefined) return null;

  const clientActionId = action.payload?.clientActionId;
  if (typeof clientActionId === 'string' && clientActionId.startsWith('roll_yut_ai')) return null;
  if (!isManualTurnActionDeadlineExpired({
    deadlineAt: state.turnDeadlineAt,
    deadlineKind: state.turnDeadlineKind,
    expectedKind: 'roll',
    clientActionId,
    networkGraceMs: TURN_NETWORK_GRACE_MS,
  })) return null;

  return { status: 'rejected', reason: '윷 던지기 제한 시간이 만료되었습니다.' };
};

const applyFallPresentationGate = (
  args: AuthoritativeArgs,
  reduction: AuthoritativeReduction,
): AuthoritativeReduction => {
  if (!isAuthoritativeCommitReduction(reduction)
    || args[1].type !== 'roll_yut'
    || reduction.payload.fallOccurred !== true) return reduction;

  const [, action] = args;
  const actorLogName = typeof action.payload?.actorLogName === 'string' && action.payload.actorLogName.trim()
    ? action.payload.actorLogName.trim()
    : action.actorId;
  const sourceLogs = Array.isArray(reduction.patch.logs) ? reduction.patch.logs as AuthoritativeLogShape[] : [];
  const keepFallRerollPrompt = reduction.patch.itemPromptTiming === 'after_roll' && reduction.patch.roll != null;
  const logs = keepFallRerollPrompt
    ? sourceLogs
    : sourceLogs.map((log, index) => index === 0 && typeof log?.text === 'string' && log.text.includes('낙')
      ? { ...log, text: `${actorLogName}님이 낙이 나와 차례를 넘깁니다.` }
      : log);
  const readyAt = Date.now() + FALL_PRESENTATION_GATE_MS;
  const fallEffect = getPendingFallEffect(reduction.patch.fallEffect);

  return {
    ...reduction,
    patch: {
      ...reduction.patch,
      roll: keepFallRerollPrompt ? reduction.patch.roll : null,
      rollResultReadyAt: readyAt,
      // applyTurnActionTimeoutPolicy converts this core 15-second deadline to the visible
      // timeout for roll/item-prompt while preserving the presentation gate offset.
      turnDeadlineAt: readyAt + TURN_ACTION_TIMEOUT_MS,
      ...(sourceLogs.length ? { logs } : {}),
    },
    payload: {
      ...reduction.payload,
      fallPresentationEventId: fallEffect?.id ?? null,
      fallPresentationReadyAt: readyAt,
      turnAdvancedIndependently: !keepFallRerollPrompt,
    },
  };
};

const resolvesAfterRollStackPrompt = (action: AuthoritativeArgs[1]) => action.type === 'use_item'
  && (action.payload?.skipAfterRollItem === true
    || action.payload?.itemType === 'move_plus_one'
    || action.payload?.itemType === 'move_minus_one');

const retryRollAfterResolvedBeforeRollPrompt = (
  args: AuthoritativeArgs,
  reduction: AuthoritativeReduction,
) => {
  const [state, action, room, sides] = args;
  if (action.type !== 'roll_yut'
    || reduction.status !== 'rejected'
    || state.itemPromptTiming != null
    || typeof state.pendingAfterMoveTurnIndex === 'number'
    || state.pendingGoldenYutSelection != null
    || state.roll != null) return reduction;

  const ownedItems = (state.ownedItems ?? {}) as Record<string, ItemType[]>;
  const actorItems = ownedItems[action.actorId] ?? [];
  const itemsWithoutBeforeRollPrompt = actorItems.filter((type) => ITEM_DEFINITIONS[type]?.timing !== 'before_roll');
  if (itemsWithoutBeforeRollPrompt.length === actorItems.length) return reduction;

  return reduceCoreAuthoritativeGameAction({
    ...state,
    ownedItems: { ...ownedItems, [action.actorId]: itemsWithoutBeforeRollPrompt },
  }, action, room, sides);
};

type PendingItemPickupShape = {
  ownerId?: unknown;
  itemType?: unknown;
  existingItemType?: unknown;
};

const isItemType = (value: unknown): value is ItemType => typeof value === 'string' && value in ITEM_DEFINITIONS;

const resolveAiPendingItemPickup = (
  args: AuthoritativeArgs,
  reduction: AuthoritativeReduction,
): AuthoritativeReduction => {
  if (!isAuthoritativeCommitReduction(reduction)) return reduction;

  const [state, action, room, sides] = args;
  const coordinatorSeatId = action.payload?.coordinatorSeatId;
  const pending = reduction.patch.pendingItemPickup as PendingItemPickupShape | null | undefined;
  if (action.type !== 'move_piece'
    || typeof coordinatorSeatId !== 'string'
    || !coordinatorSeatId
    || coordinatorSeatId === action.actorId
    || !pending
    || pending.ownerId !== action.actorId
    || !isItemType(pending.itemType)
    || !isItemType(pending.existingItemType)) return reduction;

  const decision = getAiItemValue(pending.itemType) > getAiItemValue(pending.existingItemType) ? 'replace' : 'keep';
  const resolvedState = { ...state, ...reduction.patch };
  const decisionReduction = reduceCoreAuthoritativeGameAction(
    resolvedState,
    {
      type: 'item_pickup_decision',
      actorId: action.actorId,
      payload: {
        decision,
        actorLogName: action.payload?.actorLogName,
        actorLabel: action.payload?.actorLabel,
        actorName: action.payload?.actorName,
      },
    },
    room,
    sides,
  );
  if (!isAuthoritativeCommitReduction(decisionReduction)) return reduction;

  return {
    status: 'committed',
    patch: { ...reduction.patch, ...decisionReduction.patch },
    payload: {
      ...reduction.payload,
      ...decisionReduction.payload,
      itemPickupDecision: decision,
      autoResolvedItemPickup: true,
    },
  };
};

const finalizeIndividualWinner = (
  args: AuthoritativeArgs,
  reduction: AuthoritativeReduction,
): AuthoritativeReduction => {
  if (!isAuthoritativeCommitReduction(reduction)) return reduction;

  const [, action, room] = args;
  if (action.type !== 'move_piece'
    || room.playMode !== 'individual'
    || typeof reduction.patch.winner !== 'string'
    || !reduction.patch.winner) return reduction;

  return {
    ...reduction,
    patch: {
      ...reduction.patch,
      gameEndMode: 'final',
    },
    payload: {
      ...reduction.payload,
      gameEndMode: 'final',
    },
  };
};

type TurnDeadlineKind = 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
type TimeoutCountState = {
  turnOrderIds?: unknown[];
  turnIndex?: unknown;
  turnDeadlineAt?: unknown;
  turnDeadlineKind?: TurnDeadlineKind;
  itemPromptTiming?: unknown;
  lastMovedSeatId?: unknown;
  pendingTrapPlacement?: unknown;
  pendingGoldenYutSelection?: unknown;
  pendingItemPickup?: unknown;
  turnActionTimeoutCountBySeatId?: unknown;
};

const getTimeoutCountMap = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, number>;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([seatId, count]) => [seatId, normalizeTurnActionTimeoutCount(count)]));
};

const getObjectOwnerId = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const ownerId = (value as { ownerId?: unknown }).ownerId;
  return typeof ownerId === 'string' ? ownerId : '';
};

const getTimeoutTargetSeatId = (state: TimeoutCountState) => {
  if (state.turnDeadlineKind === 'trap_placement') {
    const placementOwnerId = getObjectOwnerId(state.pendingTrapPlacement);
    if (placementOwnerId) return placementOwnerId;
  }
  if (state.turnDeadlineKind === 'item_prompt') {
    const pickupOwnerId = getObjectOwnerId(state.pendingItemPickup);
    if (pickupOwnerId) return pickupOwnerId;
    if (state.itemPromptTiming === 'after_move' && typeof state.lastMovedSeatId === 'string') return state.lastMovedSeatId;
  }
  const turnOrderIds = Array.isArray(state.turnOrderIds) ? state.turnOrderIds : [];
  const activeSeatId = turnOrderIds[Number(state.turnIndex ?? 0)];
  return typeof activeSeatId === 'string' ? activeSeatId : '';
};

const isTimeoutRecoveryAction = (action: AuthoritativeArgs[1]) => {
  const payload = action.payload;
  if (!payload || typeof payload.timeoutDeadlineAt !== 'number') return false;
  return payload.timedOut === true
    || payload.recoveredByCoordinator === true
    || payload.itemPromptTimeoutRecovery === true
    || payload.itemPickupTimeoutRecovery === true
    || payload.trapPlacementTimeoutRecovery === true
    || typeof payload.timeoutRecoveredBy === 'string';
};

const replaceNestedDeadline = (value: unknown, nextDeadline: number) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return typeof record.deadline === 'number' ? { ...record, deadline: nextDeadline } : value;
};

const getCoreDeadlineBaseMs = (kind: TurnDeadlineKind) => (
  kind === 'trap_placement' ? TURN_ITEM_PROMPT_TIMEOUT_MS : TURN_ACTION_TIMEOUT_MS
);

const getVisibleDeadlineBaseMs = (kind: TurnDeadlineKind) => (
  kind === 'item_prompt' || kind === 'trap_placement'
    ? TURN_ITEM_PROMPT_TIMEOUT_MS
    : TURN_ACTION_TIMEOUT_MS
);

const applyTurnActionTimeoutPolicy = (
  args: AuthoritativeArgs,
  reduction: AuthoritativeReduction,
): AuthoritativeReduction => {
  if (!isAuthoritativeCommitReduction(reduction)) return reduction;

  const [state, action] = args;
  const currentState = state as TimeoutCountState;
  const timeoutCounts = getTimeoutCountMap(currentState.turnActionTimeoutCountBySeatId);
  const recoveredFromTimeout = isTimeoutRecoveryAction(action);
  const previousActorTimeoutCount = action.actorId ? normalizeTurnActionTimeoutCount(timeoutCounts[action.actorId]) : 0;
  let timeoutCountChanged = false;
  if (recoveredFromTimeout && action.actorId) {
    timeoutCounts[action.actorId] = incrementTurnActionTimeoutCount(previousActorTimeoutCount);
    timeoutCountChanged = true;
  } else if (action.actorId && previousActorTimeoutCount > 0) {
    timeoutCounts[action.actorId] = 0;
    timeoutCountChanged = true;
  }

  const patch = { ...reduction.patch };
  const previousDeadline = Number(patch.turnDeadlineAt ?? 0);
  const mergedState = { ...currentState, ...patch, turnActionTimeoutCountBySeatId: timeoutCounts } as TimeoutCountState;
  const deadlineKind = (mergedState.turnDeadlineKind ?? '') as TurnDeadlineKind;

  if (previousDeadline > 0 && deadlineKind && deadlineKind !== 'turn_order') {
    const targetSeatId = getTimeoutTargetSeatId(mergedState);
    const coreBaseTimeoutMs = getCoreDeadlineBaseMs(deadlineKind);
    const visibleBaseTimeoutMs = getVisibleDeadlineBaseMs(deadlineKind);
    const nextTimeoutMs = getTurnActionTimeoutMsForCount(timeoutCounts[targetSeatId], visibleBaseTimeoutMs);
    const nextDeadline = previousDeadline - coreBaseTimeoutMs + nextTimeoutMs;
    patch.turnDeadlineAt = nextDeadline;
    if ('pendingTrapPlacement' in patch) patch.pendingTrapPlacement = replaceNestedDeadline(patch.pendingTrapPlacement, nextDeadline);
    if ('pendingGoldenYutSelection' in patch) patch.pendingGoldenYutSelection = replaceNestedDeadline(patch.pendingGoldenYutSelection, nextDeadline);
    if ('pendingItemPickup' in patch) patch.pendingItemPickup = replaceNestedDeadline(patch.pendingItemPickup, nextDeadline);
  }

  if (timeoutCountChanged) patch.turnActionTimeoutCountBySeatId = timeoutCounts;
  return { ...reduction, patch };
};

export function reduceAuthoritativeGameAction(
  ...args: AuthoritativeArgs
): AuthoritativeReduction {
  const acknowledgedFall = acknowledgeFallPresentationCompletion(args);
  if (acknowledgedFall) return acknowledgedFall;

  const presentationGateRejection = rejectRollBeforePresentationGateEnds(args);
  if (presentationGateRejection) return presentationGateRejection;

  const expiredManualRollRejection = rejectExpiredManualRoll(args);
  if (expiredManualRollRejection) return expiredManualRollRejection;

  let reduction = reduceCoreAuthoritativeGameAction(...args);
  reduction = retryRollAfterResolvedBeforeRollPrompt(args, reduction);
  reduction = resolveAiPendingItemPickup(args, reduction);
  reduction = finalizeIndividualWinner(args, reduction);
  reduction = applyFallPresentationGate(args, reduction);

  const [state, action, room] = args;
  if (isAuthoritativeCommitReduction(reduction) && room.stackedRollMode && action.type === 'roll_yut') {
    const nextRollStack = (reduction.patch.rollStack ?? state.rollStack) as unknown[] | undefined;
    const nextRollStackClosed = reduction.patch.rollStackClosed ?? state.rollStackClosed;
    if (nextRollStack?.length && nextRollStackClosed === false) {
      reduction = {
        ...reduction,
        patch: {
          ...reduction.patch,
          roll: null,
          selectedRollStackIndex: null,
          turnDeadlineKind: 'roll',
        },
      };
    }
  }

  if (isAuthoritativeCommitReduction(reduction) && room.stackedRollMode && resolvesAfterRollStackPrompt(action)) {
    const resolvedRollStack = (reduction.patch.rollStack ?? state.rollStack) as unknown[] | undefined;
    if (resolvedRollStack && resolvedRollStack.length >= 2) {
      reduction = {
        ...reduction,
        patch: {
          ...reduction.patch,
          roll: null,
          selectedRollStackIndex: null,
          rollStackClosed: true,
        },
      };
    }
  }

  return applyTurnActionTimeoutPolicy(args, reduction);
}
