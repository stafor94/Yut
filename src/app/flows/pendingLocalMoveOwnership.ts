import { localMovePresentationLifecycle } from './localMovePresentationLifecycle';

export type PendingLocalMoveAction = {
  type: 'move_piece';
  actorId: string;
  payload?: Record<string, unknown>;
};

export type PendingLocalMoveOwnershipRequest = {
  action: PendingLocalMoveAction;
  totalSteps: number;
  authoritativeSnapshot: Record<string, unknown> | null;
};

export type PendingLocalMoveOwnershipSuccess = {
  ok: true;
  action: PendingLocalMoveAction;
  actionKey: string;
};

type PendingLocalMoveOwnershipFailureShape = {
  ok: false;
  action: PendingLocalMoveAction;
  actionKey: string;
  stage: string;
  reason: string;
};

// App records this value across callbacks invoked synchronously by commitAcceptedMovePresentation.
// Keep the callback-held diagnostic value permissive here; the public result union below remains structured.
export type PendingLocalMoveOwnershipFailure = any;

export type PendingLocalMoveOwnershipResult = PendingLocalMoveOwnershipSuccess | PendingLocalMoveOwnershipFailureShape;
export type PendingLocalMoveOwnershipPreparer = (
  request: PendingLocalMoveOwnershipRequest,
) => PendingLocalMoveOwnershipResult;

let currentOwnershipPreparer: PendingLocalMoveOwnershipPreparer | null = null;

const getActionKey = (action: PendingLocalMoveAction) => {
  const clientActionId = action.payload?.clientActionId;
  return typeof clientActionId === 'string' ? clientActionId : '';
};

const failure = (
  request: PendingLocalMoveOwnershipRequest,
  stage: string,
  reason: string,
): PendingLocalMoveOwnershipFailureShape => ({
  ok: false,
  action: request.action,
  actionKey: getActionKey(request.action),
  stage,
  reason,
});

export function requiresPendingLocalMoveOwnership(request: PendingLocalMoveOwnershipRequest) {
  return request.action.type === 'move_piece' && request.totalSteps !== 0 && Boolean(getActionKey(request.action));
}

export function publishPendingLocalMoveOwnershipPreparer(preparer: PendingLocalMoveOwnershipPreparer) {
  currentOwnershipPreparer = preparer;
}

export function clearPendingLocalMoveOwnershipPreparer(preparer: PendingLocalMoveOwnershipPreparer) {
  if (currentOwnershipPreparer === preparer) currentOwnershipPreparer = null;
}

export function preparePendingLocalMoveOwnership(
  request: PendingLocalMoveOwnershipRequest,
): PendingLocalMoveOwnershipResult {
  const actionKey = getActionKey(request.action);
  if (!actionKey) return failure(request, 'action-validation', 'move-client-action-id-missing');
  if (!Number.isFinite(request.totalSteps)) return failure(request, 'action-validation', 'move-total-steps-invalid');
  if (request.totalSteps === 0) {
    const presentation = localMovePresentationLifecycle.snapshot();
    if (presentation.actionKey === actionKey) localMovePresentationLifecycle.cancel();
    return { ok: true, action: request.action, actionKey };
  }
  if (!request.authoritativeSnapshot) return failure(request, 'authoritative-state', 'current-sequence-state-missing');
  if (!currentOwnershipPreparer) return failure(request, 'ownership-preparer', 'ownership-preparer-unavailable');
  return currentOwnershipPreparer(request);
}
