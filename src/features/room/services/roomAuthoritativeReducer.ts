import {
  isAuthoritativeCommitReduction,
  reduceAuthoritativeGameAction as reduceCoreAuthoritativeGameAction,
} from './roomAuthoritativeReducerCore';

export * from './roomAuthoritativeReducerCore';

const resolvesAfterRollStackPrompt = (action: Parameters<typeof reduceCoreAuthoritativeGameAction>[1]) => action.type === 'use_item'
  && (action.payload?.skipAfterRollItem === true
    || action.payload?.itemType === 'move_plus_one'
    || action.payload?.itemType === 'move_minus_one');

export function reduceAuthoritativeGameAction(
  ...args: Parameters<typeof reduceCoreAuthoritativeGameAction>
): ReturnType<typeof reduceCoreAuthoritativeGameAction> {
  const reduction = reduceCoreAuthoritativeGameAction(...args);
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
