import {
  reduceAuthoritativeGameAction as reduceAuthoritativeGameActionImplementation,
} from './roomAuthoritativeReducerImplementation';

export * from './roomAuthoritativeReducerImplementation';

/**
 * Local move presentation state keeps `pieces` non-enumerable so applying the
 * authoritative patch cannot jump the rendered token to its final position.
 * Reducers are calculation-only, so normalize that hidden array on a temporary
 * clone before any nested object spread can discard it.
 */
export const reduceAuthoritativeGameAction: typeof reduceAuthoritativeGameActionImplementation = (...args) => {
  const [state, action, room, sides] = args;
  const reductionState = Array.isArray(state.pieces)
    && !Object.prototype.propertyIsEnumerable.call(state, 'pieces')
    ? { ...state, pieces: state.pieces }
    : state;
  const reduction = reduceAuthoritativeGameActionImplementation(reductionState, action, room, sides);
  if (reduction.status !== 'committed' || action.type !== 'move_piece') return reduction;

  const patch = reduction.patch;
  const clientActionId = typeof action.payload?.clientActionId === 'string'
    ? action.payload.clientActionId
    : '';
  const captureEffect = patch?.captureEffect;
  if (!patch || !clientActionId || !captureEffect || typeof captureEffect !== 'object' || Array.isArray(captureEffect)) {
    return reduction;
  }

  return {
    ...reduction,
    patch: {
      ...patch,
      captureEffect: {
        ...captureEffect,
        presentationKey: clientActionId,
      },
    },
  };
};
