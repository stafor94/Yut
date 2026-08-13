import {
  reduceAuthoritativeGameAction as reduceAuthoritativeGameActionImplementation,
} from './roomAuthoritativeReducerImplementation';
import { getTrustedManualMoveReservationContextFromAction } from './manualMoveReservationPolicy';
import {
  attachLatestStackedMoveSelectionIdentity,
  validateStackedMoveSelectionIdentity,
} from './stackedMoveSelectionIdentity';
import { preserveRemainingStackMoveDeadline } from './stackedMoveDeadlinePolicy';

export * from './roomAuthoritativeReducerImplementation';

/**
 * Local move presentation state keeps `pieces` non-enumerable so applying the
 * authoritative patch cannot jump the rendered token to its final position.
 * Reducers are calculation-only, so normalize that hidden array on a temporary
 * clone before any nested object spread can discard it.
 */
export const reduceAuthoritativeGameAction: typeof reduceAuthoritativeGameActionImplementation = (...args) => {
  const [state, action, room, sides] = args;
  attachLatestStackedMoveSelectionIdentity(action);
  const stackedMoveSelectionRejection = validateStackedMoveSelectionIdentity({
    state,
    action,
    stackedRollMode: room.stackedRollMode === true,
  });
  if (stackedMoveSelectionRejection) {
    return { status: 'rejected', reason: stackedMoveSelectionRejection };
  }

  const reductionState = Array.isArray(state.pieces)
    && !Object.prototype.propertyIsEnumerable.call(state, 'pieces')
    ? { ...state, pieces: state.pieces }
    : state;
  const stateSequence = Number((state as typeof state & { lastSequence?: unknown }).lastSequence ?? 0);
  const trustedManualMoveReservation = getTrustedManualMoveReservationContextFromAction(action);
  const canHonorTrustedManualMoveStart = action.type === 'move_piece'
    && trustedManualMoveReservation != null
    && trustedManualMoveReservation.actorId === action.actorId
    && trustedManualMoveReservation.clientActionId === action.payload?.clientActionId
    && trustedManualMoveReservation.clientActionStartedAt === Number(action.payload?.clientActionStartedAt ?? 0)
    && trustedManualMoveReservation.expectedPreviousSequence === stateSequence
    && trustedManualMoveReservation.expectedTurnIndex === Number(state.turnIndex ?? -1)
    && trustedManualMoveReservation.deadlineAt === Number(state.turnDeadlineAt ?? 0)
    && trustedManualMoveReservation.serverReceivedAt <= trustedManualMoveReservation.deadlineAt
    && trustedManualMoveReservation.expiresAt > Date.now();
  const reductionAction = canHonorTrustedManualMoveStart
    ? {
        ...action,
        payload: {
          ...action.payload,
          // The transaction already proved that the matching server-authored
          // reservation arrived before this exact deadline. Clearing only the
          // reducer-local timestamp bypasses the post-grace guard without
          // exposing a client-controlled payload flag or changing the event.
          clientActionStartedAt: 0,
        },
      }
    : action;
  const reduction = reduceAuthoritativeGameActionImplementation(reductionState, reductionAction, room, sides);
  if (reduction.status !== 'committed' || action.type !== 'move_piece') return reduction;

  const patch = reduction.patch;
  const normalizedPatch = patch
    ? preserveRemainingStackMoveDeadline(patch, {
        stackedRollMode: room.stackedRollMode === true,
        captured: Boolean(reduction.payload?.captured),
      })
    : patch;
  const normalizedReduction = normalizedPatch === patch
    ? reduction
    : { ...reduction, patch: normalizedPatch };
  const clientActionId = typeof action.payload?.clientActionId === 'string'
    ? action.payload.clientActionId
    : '';
  const captureEffect = normalizedPatch?.captureEffect;
  if (!normalizedPatch || !clientActionId || !captureEffect || typeof captureEffect !== 'object' || Array.isArray(captureEffect)) {
    return normalizedReduction;
  }

  return {
    ...normalizedReduction,
    patch: {
      ...normalizedPatch,
      captureEffect: {
        ...captureEffect,
        presentationKey: clientActionId,
      },
    },
  };
};
