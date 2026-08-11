import { localMovePresentationLifecycle } from './localMovePresentationLifecycle';

export type PendingLocalMoveAction = {
  type: 'move_piece';
  actorId: string;
  payload?: Record<string, unknown>;
};

export type PendingLocalMoveOwnershipPreparer = (action: PendingLocalMoveAction) => boolean;

let currentOwnershipPreparer: PendingLocalMoveOwnershipPreparer | null = null;

type ParsedPendingMoveAction = {
  action: PendingLocalMoveAction;
  totalSteps: number | null;
};

function parsePendingMoveAction(actionKey: string): ParsedPendingMoveAction | null {
  if (!actionKey.startsWith('move_piece:')) return null;
  const parts = actionKey.split(':');
  if (parts.lastIndexOf('stack') !== 11 || parts.length < 13) return null;
  const actorId = parts[1] ?? '';
  const rollSteps = Number(parts[5]);
  const pieceId = parts[8] ?? '';
  const extraSteps = Number(parts[9] ?? 0);
  const branchChoice = parts[10] ?? '';
  const stackIndexToken = parts[12] ?? 'none';
  if (!actorId || !pieceId || !Number.isFinite(extraSteps)) return null;
  const rollStackIndex = stackIndexToken === 'none' ? null : Number(stackIndexToken);
  if (rollStackIndex !== null && (!Number.isInteger(rollStackIndex) || rollStackIndex < 0)) return null;
  return {
    action: {
      type: 'move_piece',
      actorId,
      payload: {
        clientActionId: actionKey,
        pieceId,
        extraSteps,
        branchChoice,
        rollStackIndex,
      },
    },
    totalSteps: Number.isFinite(rollSteps) ? rollSteps + extraSteps : null,
  };
}

export function requiresPendingLocalMoveOwnership(actionKey: string) {
  return Boolean(parsePendingMoveAction(actionKey));
}

export function publishPendingLocalMoveOwnershipPreparer(preparer: PendingLocalMoveOwnershipPreparer) {
  currentOwnershipPreparer = preparer;
}

export function clearPendingLocalMoveOwnershipPreparer(preparer: PendingLocalMoveOwnershipPreparer) {
  if (currentOwnershipPreparer === preparer) currentOwnershipPreparer = null;
}

export function preparePendingLocalMoveOwnership(actionKey: string) {
  const parsed = parsePendingMoveAction(actionKey);
  if (!parsed || !currentOwnershipPreparer) return false;
  if (parsed.totalSteps === 0) {
    const presentation = localMovePresentationLifecycle.snapshot();
    if (presentation.actionKey === actionKey) localMovePresentationLifecycle.cancel();
    return true;
  }
  return currentOwnershipPreparer(parsed.action);
}
