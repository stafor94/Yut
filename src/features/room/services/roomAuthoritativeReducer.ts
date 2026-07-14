import { ITEM_DEFINITIONS, getAiItemValue, type ItemType } from '../../items/logic/items';
import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction as reduceCoreAuthoritativeGameAction,
} from './roomAuthoritativeReducerCore';

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

  // itemPromptTiming is the authoritative per-turn gate. After an explicit skip it is null,
  // so retained before-roll items are removed only for this retry. Any unrelated rejection
  // is evaluated again by the core reducer and remains rejected without depending on message text.
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

export function reduceAuthoritativeGameAction(
  ...args: Parameters<typeof reduceCoreAuthoritativeGameAction>
): ReturnType<typeof reduceCoreAuthoritativeGameAction> {
  let reduction = reduceCoreAuthoritativeGameAction(...args);
  reduction = retryRollAfterResolvedBeforeRollPrompt(args, reduction);
  reduction = resolveAiPendingItemPickup(args, reduction);
  if (!isAuthoritativeCommitReduction(reduction)) return reduction;

  const [state, action, room] = args;
  if (room.stackedRollMode && action.type === 'roll_yut') {
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

  if (!room.stackedRollMode || !resolvesAfterRollStackPrompt(action)) return reduction;

  const resolvedRollStack = (reduction.patch.rollStack ?? state.rollStack) as unknown[] | undefined;
  if (!resolvedRollStack || resolvedRollStack.length < 2) return reduction;

  return {
    ...reduction,
    patch: {
      ...reduction.patch,
      roll: null,
      selectedRollStackIndex: null,
      rollStackClosed: true,
    },
  };
}
