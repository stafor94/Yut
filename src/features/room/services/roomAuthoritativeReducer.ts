import { ITEM_DEFINITIONS, getAiItemValue, type ItemType } from '../../items/logic/items';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction as reduceCoreAuthoritativeGameAction,
} from './roomAuthoritativeReducerCore';
import {
  TURN_ACTION_TIMEOUT_MS,
  TURN_ITEM_PROMPT_TIMEOUT_MS,
  getTurnActionTimeoutMsForCount,
  incrementTurnActionTimeoutCount,
  normalizeTurnActionTimeoutCount,
} from './roomTiming';

export * from './roomAuthoritativeReducerCore';

const resolvesAfterRollStackPrompt = (action: Parameters<typeof reduceCoreAuthoritativeGameAction>[1]) => action.type === 'use_item'
  && (action.payload?.skipAfterRollItem === true
    || action.payload?.itemType === 'move_plus_one'
    || action.payload?.itemType === 'move_minus_one');

const retryRollAfterResolvedBeforeRollPrompt = (
  args: Parameters<typeof reduceCoreAuthoritativeGameAction>,
  reduction: ReturnType<typeof reduceCoreAuthoritativeGameAction>,
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
  args: Parameters<typeof reduceCoreAuthoritativeGameAction>,
  reduction: ReturnType<typeof reduceCoreAuthoritativeGameAction>,
): ReturnType<typeof reduceCoreAuthoritativeGameAction> => {
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
  args: Parameters<typeof reduceCoreAuthoritativeGameAction>,
  reduction: ReturnType<typeof reduceCoreAuthoritativeGameAction>,
): ReturnType<typeof reduceCoreAuthoritativeGameAction> => {
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

const isTimeoutRecoveryAction = (action: Parameters<typeof reduceCoreAuthoritativeGameAction>[1]) => {
  const payload = action.payload;
  if (!payload || typeof payload.timeoutDeadlineAt !== 'number') return false;
  return payload.timedOut === true
    || payload.recoveredByCoordinator === true
    || payload.itemPromptTimeoutRecovery === true
    || payload.trapPlacementTimeoutRecovery === true
    || typeof payload.timeoutRecoveredBy === 'string';
};

const replaceMatchingNestedDeadline = (value: unknown, previousDeadline: number, nextDeadline: number) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Number(record.deadline ?? 0) === previousDeadline ? { ...record, deadline: nextDeadline } : value;
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
  args: Parameters<typeof reduceCoreAuthoritativeGameAction>,
  reduction: ReturnType<typeof reduceCoreAuthoritativeGameAction>,
): ReturnType<typeof reduceCoreAuthoritativeGameAction> => {
  if (!isAuthoritativeCommitReduction(reduction)) return reduction;

  const [state, action] = args;
  const currentState = state as TimeoutCountState;
  const timeoutCounts = getTimeoutCountMap(currentState.turnActionTimeoutCountBySeatId);
  const recoveredFromTimeout = isTimeoutRecoveryAction(action);
  if (recoveredFromTimeout && action.actorId) {
    timeoutCounts[action.actorId] = incrementTurnActionTimeoutCount(timeoutCounts[action.actorId]);
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
    if ('pendingTrapPlacement' in patch) patch.pendingTrapPlacement = replaceMatchingNestedDeadline(patch.pendingTrapPlacement, previousDeadline, nextDeadline);
    if ('pendingGoldenYutSelection' in patch) patch.pendingGoldenYutSelection = replaceMatchingNestedDeadline(patch.pendingGoldenYutSelection, previousDeadline, nextDeadline);
    if ('pendingItemPickup' in patch) patch.pendingItemPickup = replaceMatchingNestedDeadline(patch.pendingItemPickup, previousDeadline, nextDeadline);
  }

  if (recoveredFromTimeout) patch.turnActionTimeoutCountBySeatId = timeoutCounts;
  return { ...reduction, patch };
};

export function reduceAuthoritativeGameAction(
  ...args: Parameters<typeof reduceCoreAuthoritativeGameAction>
): ReturnType<typeof reduceCoreAuthoritativeGameAction> {
  let reduction = reduceCoreAuthoritativeGameAction(...args);
  reduction = retryRollAfterResolvedBeforeRollPrompt(args, reduction);
  reduction = resolveAiPendingItemPickup(args, reduction);
  reduction = finalizeIndividualWinner(args, reduction);

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
