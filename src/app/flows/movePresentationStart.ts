export type MovePresentationStartBlockReason =
  | 'winner'
  | 'moving-piece-active'
  | 'move-in-progress'
  | 'piece-not-found'
  | 'piece-not-controllable'
  | 'piece-finished'
  | 'off-board-backdo'
  | 'execution-right-unavailable'
  | 'presentation-preparation-failed';

export type MovePresentationPreparation<TPrepared> =
  | { accepted: true; prepared: TPrepared }
  | { accepted: false; reason: MovePresentationStartBlockReason; message?: string };

export type MovePresentationStart<TCompletion> =
  | { started: true; completion: TCompletion }
  | { started: false; reason: string };

type MovePieceLike = {
  id: string;
  started: boolean;
  finished: boolean;
};

export function prepareMovePresentationStart<TPiece extends MovePieceLike, TPrepared>({
  winner,
  movingPieceId,
  moveInProgress,
  pieces,
  pieceId,
  steps,
  canControlPiece,
  prepare,
  acquireExecution,
}: {
  winner: boolean;
  movingPieceId: string;
  moveInProgress: boolean;
  pieces: TPiece[];
  pieceId: string;
  steps: number;
  canControlPiece: (piece: TPiece) => boolean;
  prepare: (piece: TPiece) => TPrepared;
  acquireExecution: () => boolean;
}): MovePresentationPreparation<TPrepared> {
  if (winner) return { accepted: false, reason: 'winner' };
  if (movingPieceId) return { accepted: false, reason: 'moving-piece-active' };
  if (moveInProgress) return { accepted: false, reason: 'move-in-progress' };

  const piece = pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) return { accepted: false, reason: 'piece-not-found' };
  if (!canControlPiece(piece)) return { accepted: false, reason: 'piece-not-controllable' };
  if (piece.finished) return { accepted: false, reason: 'piece-finished' };
  if (steps < 0 && !piece.started) return { accepted: false, reason: 'off-board-backdo' };

  let prepared: TPrepared;
  try {
    prepared = prepare(piece);
  } catch (error) {
    return {
      accepted: false,
      reason: 'presentation-preparation-failed',
      message: error instanceof Error ? error.message : 'unknown preparation failure',
    };
  }
  if (!acquireExecution()) return { accepted: false, reason: 'execution-right-unavailable' };
  return { accepted: true, prepared };
}

export function commitAcceptedMovePresentation<TPrepared, TCompletion>({
  prepared,
  registerOwnership,
  startPresentation,
  rollbackOwnership,
  releaseExecution,
}: {
  prepared: TPrepared;
  registerOwnership: () => boolean;
  startPresentation: (prepared: TPrepared) => MovePresentationStart<TCompletion>;
  rollbackOwnership: () => void;
  releaseExecution: () => void;
}): MovePresentationStart<TCompletion> {
  let ownershipRegistered = false;
  try {
    if (!registerOwnership()) {
      rollbackOwnership();
      releaseExecution();
      return { started: false, reason: 'ownership-registration-failed' };
    }
    ownershipRegistered = true;
    const start = startPresentation(prepared);
    if (start.started) return start;
    rollbackOwnership();
    releaseExecution();
    return start;
  } catch (error) {
    if (ownershipRegistered) rollbackOwnership();
    releaseExecution();
    return {
      started: false,
      reason: error instanceof Error ? `presentation-start-exception:${error.message}` : 'presentation-start-exception',
    };
  }
}
