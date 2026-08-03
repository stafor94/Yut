import type { GameAction } from '../../features/room/services/roomService';

type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;
export type PendingLocalMoveOwnershipPreparer = (action: CommittableGameAction) => boolean;

let currentOwnershipPreparer: PendingLocalMoveOwnershipPreparer | null = null;

function parsePendingMoveAction(actionKey: string): CommittableGameAction | null {
  if (!actionKey.startsWith('move_piece:')) return null;
  const parts = actionKey.split(':');
  if (parts.lastIndexOf('stack') !== 11 || parts.length < 13) return null;
  const actorId = parts[1] ?? '';
  const pieceId = parts[8] ?? '';
  const extraSteps = Number(parts[9] ?? 0);
  const branchChoice = parts[10] ?? '';
  const stackIndexToken = parts[12] ?? 'none';
  if (!actorId || !pieceId || !Number.isFinite(extraSteps)) return null;
  const rollStackIndex = stackIndexToken === 'none' ? null : Number(stackIndexToken);
  if (rollStackIndex !== null && (!Number.isInteger(rollStackIndex) || rollStackIndex < 0)) return null;
  return {
    type: 'move_piece',
    actorId,
    payload: {
      clientActionId: actionKey,
      pieceId,
      extraSteps,
      branchChoice,
      rollStackIndex,
    },
  } as CommittableGameAction;
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
  const action = parsePendingMoveAction(actionKey);
  if (!action || !currentOwnershipPreparer) return false;
  return currentOwnershipPreparer(action);
}
