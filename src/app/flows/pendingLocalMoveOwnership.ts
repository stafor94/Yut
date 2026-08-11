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
  const stackMarkerIndex = parts.lastIndexOf('stack');
  if (stackMarkerIndex < 4 || stackMarkerIndex !== parts.length - 2) return null;
  const actorId = parts[1] ?? '';
  const pieceId = parts[stackMarkerIndex - 3] ?? '';
  const extraSteps = Number(parts[stackMarkerIndex - 2] ?? 0);
  const branchChoice = parts[stackMarkerIndex - 1] ?? '';
  const stackIndexToken = parts[stackMarkerIndex + 1] ?? 'none';
  if (!actorId || !pieceId || !Number.isFinite(extraSteps)) return null;
  const rollStackIndex = stackIndexToken === 'none' ? null : Number(stackIndexToken);
  if (rollStackIndex !== null && (!Number.isInteger(rollStackIndex) || rollStackIndex < 0)) return null;
  const rollSteps = parts[4] === 'ready' ? null : Number(parts[5]);
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
    totalSteps: rollSteps !== null && Number.isFinite(rollSteps) ? rollSteps + extraSteps : null,
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
