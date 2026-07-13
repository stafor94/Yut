import { ITEM_DEFINITIONS, type ItemType } from '../../items/logic/items';
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

export function reduceAuthoritativeGameAction(
  ...args: Parameters<typeof reduceCoreAuthoritativeGameAction>
): ReturnType<typeof reduceCoreAuthoritativeGameAction> {
  let reduction = reduceCoreAuthoritativeGameAction(...args);
  reduction = retryRollAfterResolvedBeforeRollPrompt(args, reduction);
  if (!isAuthoritativeCommitReduction(reduction)) return reduction;

  const [state, action, room] = args;
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
