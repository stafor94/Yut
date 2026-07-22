import { GOLDEN_YUT_CHOICES, getRollTimingPositionPercent, getRollTimingZone, type RollTimingZone, type YutResult } from '../../../game-core/roll';
import type { BranchChoice } from '../../../game-core/board/board';
import { TURN_ACTION_TIMEOUT_MS } from './roomTiming';

/**
 * Coordinator recovery cannot observe another client's live timing orb. Use the
 * deterministic end-of-window position instead of treating an epoch timestamp
 * as animation elapsed time. The active client submits the actual visible orb
 * position through the normal roll path just before the deadline.
 */
export const resolveRollTimeout = (_deadlineAt: number, timeoutWindowMs = TURN_ACTION_TIMEOUT_MS): { rollTimingZone: RollTimingZone; timingPositionPercent: number } => {
  const timingPositionPercent = getRollTimingPositionPercent(Math.max(0, timeoutWindowMs));
  return { rollTimingZone: getRollTimingZone(timingPositionPercent), timingPositionPercent };
};

export type MoveTimeoutPiece = { id: string; label?: string; nodeId: string; started: boolean; finished: boolean };

export const resolveMoveTimeout = <TPiece extends MoveTimeoutPiece>(params: {
  pieces: TPiece[];
  selectedPieceId?: string | null;
  steps: number;
  canControlPiece: (piece: TPiece) => boolean;
  isSameSidePiece: (piece: TPiece, selected: TPiece) => boolean;
  branchChoice?: BranchChoice;
}): { pieceId: string; branchChoice: BranchChoice; reason: 'selected' | 'deterministic' | 'pass' } => {
  const canMovePiece = (piece: TPiece) => params.steps >= 0 || piece.started;
  const movablePieces = params.pieces.filter((piece) => params.canControlPiece(piece) && !piece.finished && canMovePiece(piece));
  const selectedPiece = movablePieces.find((piece) => piece.id === params.selectedPieceId);
  if (selectedPiece) return { pieceId: selectedPiece.id, branchChoice: params.branchChoice ?? 'outer', reason: 'selected' };
  const grouped = Array.from(new Map(movablePieces.map((piece) => [piece.started ? piece.nodeId : piece.id, piece])).values());
  const deterministic = [...grouped].sort((left, right) => {
    const leftStarted = left.started ? 0 : 1;
    const rightStarted = right.started ? 0 : 1;
    if (leftStarted !== rightStarted) return leftStarted - rightStarted;
    return String(left.label ?? left.id).localeCompare(String(right.label ?? right.id), undefined, { numeric: true });
  })[0];
  return deterministic
    ? { pieceId: deterministic.id, branchChoice: params.branchChoice ?? 'outer', reason: 'deterministic' }
    : { pieceId: '', branchChoice: 'outer', reason: 'pass' };
};

export const resolveItemPromptTimeout = () => ({ useItem: false as const });
export const resolveTrapPlacementTimeout = () => ({ cancelTrapPlacement: true as const });
export const resolveItemPickupTimeout = () => ({ decision: 'keep' as const });
export const resolveGoldenYutTimeout = (): YutResult => {
  const mo = GOLDEN_YUT_CHOICES.find((choice) => choice.name === '모');
  if (!mo) return { name: '모', steps: 5, bonus: true };
  return mo;
};

/** One authoritative timeout action per room, stage, actor, and deadline. */
export const makeTimeoutActionKey = (params: {
  roomId?: string;
  stage: string;
  actorId: string;
  timeoutDeadlineAt: number;
  turnVersion?: number;
  sequence?: number;
  extra?: string;
}) => [
  'timeout',
  params.roomId ?? 'local',
  params.stage,
  params.actorId,
  params.timeoutDeadlineAt,
].join(':');
