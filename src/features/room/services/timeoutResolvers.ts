import {
  GOLDEN_YUT_CHOICES,
  getRollTimingPositionPercent,
  getRollTimingZone,
  type RollTimingZone,
  type YutResult,
} from '../../../game-core/roll';
import type { BranchChoice } from '../../../game-core/board/board';
import { getRollStackSelectionAvailability } from '../../../game-core/rollStackSelection';
import { TURN_ACTION_TIMEOUT_MS } from './roomTiming';

/**
 * The active client freezes and submits the DOM-visible orb position at the deadline.
 * If that client disappears, coordinators reconstruct the intended animation
 * position from the authoritative timeout window instead of forcing Bad.
 */
export const resolveRollTimeout = (
  _deadlineAt: number,
  timeoutWindowMs = TURN_ACTION_TIMEOUT_MS,
): { rollTimingZone: RollTimingZone; timingPositionPercent: number } => {
  const normalizedWindowMs = Number.isFinite(timeoutWindowMs) && timeoutWindowMs > 0
    ? timeoutWindowMs
    : TURN_ACTION_TIMEOUT_MS;
  const timingPositionPercent = getRollTimingPositionPercent(normalizedWindowMs);
  return {
    rollTimingZone: getRollTimingZone(timingPositionPercent),
    timingPositionPercent,
  };
};

export type MoveTimeoutContextReason = 'selected' | 'default-first' | 'first-selectable' | 'single' | 'non-stacked' | 'unresolved';
export type MoveTimeoutContext = {
  roll: YutResult | null;
  rollStackIndex: number | null;
  steps: number;
  reason: MoveTimeoutContextReason;
};

const isValidTimeoutMoveRoll = (value: YutResult | null | undefined): value is YutResult => Boolean(
  value
  && typeof value.name === 'string'
  && Number.isFinite(value.steps),
);

const makeResolvedTimeoutMoveContext = (
  roll: YutResult,
  rollStackIndex: number | null,
  reason: Exclude<MoveTimeoutContextReason, 'unresolved'>,
): MoveTimeoutContext => ({
  roll: { ...roll },
  rollStackIndex,
  steps: roll.steps,
  reason,
});

/**
 * Manual stack selection deliberately stays unresolved until the player chooses.
 * Timeout recovery instead snapshots one deterministic roll and stack index so a
 * delayed UI callback can never be the only path that advances the game.
 */
export const resolveMoveTimeoutContext = (params: {
  stackedRollMode: boolean;
  roll: YutResult | null;
  rollStack: YutResult[];
  rollStackClosed: boolean;
  selectedRollStackIndex: number | null;
  hasBackDoMovablePiece?: boolean;
}): MoveTimeoutContext => {
  const unresolved: MoveTimeoutContext = { roll: null, rollStackIndex: null, steps: 0, reason: 'unresolved' };
  if (!params.stackedRollMode) {
    return isValidTimeoutMoveRoll(params.roll)
      ? makeResolvedTimeoutMoveContext(params.roll, null, 'non-stacked')
      : unresolved;
  }
  if (!params.rollStackClosed || params.rollStack.length === 0) return unresolved;

  if (typeof params.selectedRollStackIndex === 'number') {
    if (!Number.isInteger(params.selectedRollStackIndex)
      || params.selectedRollStackIndex < 0
      || params.selectedRollStackIndex >= params.rollStack.length) return unresolved;
    const selectedRoll = params.rollStack[params.selectedRollStackIndex];
    return isValidTimeoutMoveRoll(selectedRoll)
      ? makeResolvedTimeoutMoveContext(selectedRoll, params.selectedRollStackIndex, 'selected')
      : unresolved;
  }

  if (!params.rollStack.every(isValidTimeoutMoveRoll)) return unresolved;
  const availability = getRollStackSelectionAvailability({
    rollStack: params.rollStack,
    hasBackDoMovablePiece: params.hasBackDoMovablePiece !== false,
  });
  const firstSelectableIndex = availability.findIndex(Boolean);
  if (firstSelectableIndex < 0) return unresolved;
  const firstSelectableRoll = params.rollStack[firstSelectableIndex];
  return makeResolvedTimeoutMoveContext(
    firstSelectableRoll,
    firstSelectableIndex,
    params.rollStack.length === 1
      ? 'single'
      : firstSelectableIndex === 0 ? 'default-first' : 'first-selectable',
  );
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
