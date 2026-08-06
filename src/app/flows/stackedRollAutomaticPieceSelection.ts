import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { YutResult } from '../../game-core/roll';
import { calculatePieceSelection } from './pieceSelection';

type StackedRollAutomaticPieceSelectionInput = {
  pieces: BoardPiece[];
  selectedPieceId: string;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  isLocalTurn: boolean;
  canControlPiece: (piece: BoardPiece) => boolean;
  isSameSidePiece: (piece: BoardPiece, selectedPiece: BoardPiece) => boolean;
};

export function getStackedRollAutomaticPiece({
  pieces,
  selectedPieceId,
  rollStack,
  selectedRollStackIndex,
  rollStackClosed,
  isLocalTurn,
  canControlPiece,
  isSameSidePiece,
}: StackedRollAutomaticPieceSelectionInput) {
  if (!isLocalTurn || !rollStackClosed || typeof selectedRollStackIndex !== 'number') return undefined;
  const selectedRoll = rollStack[selectedRollStackIndex];
  if (!selectedRoll) return undefined;

  return calculatePieceSelection({
    pieces,
    selectedPieceId,
    hasMoveRoll: true,
    isLocalTurn: true,
    moveSteps: selectedRoll.steps,
    canControlPiece,
    isSameSidePiece,
  }).pieceToMove;
}
