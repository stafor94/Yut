export type PieceSelectionBoardPiece = {
  id: string;
  label: string;
  ownerId: string;
  nodeId: string;
  started: boolean;
  finished: boolean;
  color: string;
  nodeIndex: number;
  previousNodeId?: string;
};

type BoardPiece = PieceSelectionBoardPiece;

export type PieceSelectionResult = {
  selectedGroupPieceIds: string[];
  pieceToMove?: BoardPiece;
  selectedPieceCanMove: boolean;
};

type PieceSelectionInput = {
  pieces: BoardPiece[];
  selectedPieceId: string;
  hasMoveRoll: boolean;
  isLocalTurn: boolean;
  moveSteps: number;
  canControlPiece: (piece: BoardPiece) => boolean;
  isSameSidePiece: (piece: BoardPiece, selectedPiece: BoardPiece) => boolean;
};

const comparePieceLabel = (left: BoardPiece, right: BoardPiece) => left.label.localeCompare(right.label, undefined, { numeric: true });

export function getLowestLabelPiece(pieces: BoardPiece[]) {
  return [...pieces].sort(comparePieceLabel)[0];
}

export function calculatePieceSelection({
  pieces,
  selectedPieceId,
  hasMoveRoll,
  isLocalTurn,
  moveSteps,
  canControlPiece,
  isSameSidePiece,
}: PieceSelectionInput): PieceSelectionResult {
  const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId);
  const canMovePiece = (piece: BoardPiece) => hasMoveRoll && isLocalTurn && canControlPiece(piece) && !piece.finished && (moveSteps >= 0 || piece.started);
  const movablePieces = pieces.filter(canMovePiece);
  const selectedPieceCanMove = Boolean(selectedPiece && canMovePiece(selectedPiece));

  const selectedOffBoardGroup = selectedPiece && hasMoveRoll && isLocalTurn && canControlPiece(selectedPiece) && !selectedPiece.started && !selectedPiece.finished && moveSteps >= 0
    ? pieces.filter((piece) => canControlPiece(piece) && !piece.started && !piece.finished)
    : [];
  if (selectedOffBoardGroup.length) {
    return {
      selectedGroupPieceIds: selectedOffBoardGroup.map((piece) => piece.id),
      pieceToMove: getLowestLabelPiece(selectedOffBoardGroup),
      selectedPieceCanMove,
    };
  }

  if (selectedPiece?.started && !selectedPiece.finished) {
    return {
      selectedGroupPieceIds: pieces
        .filter((piece) => piece.started && !piece.finished && piece.nodeId === selectedPiece.nodeId && isSameSidePiece(piece, selectedPiece))
        .map((piece) => piece.id),
      pieceToMove: selectedPieceCanMove ? selectedPiece : movablePieces[0],
      selectedPieceCanMove,
    };
  }

  if (selectedPiece && !selectedPiece.finished) {
    const fallbackPiece = getLowestLabelPiece(movablePieces.filter((piece) => !piece.started)) ?? movablePieces[0];
    return {
      selectedGroupPieceIds: [selectedPiece.id],
      pieceToMove: selectedPieceCanMove ? selectedPiece : fallbackPiece,
      selectedPieceCanMove,
    };
  }

  const onBoardFallback = movablePieces.find((piece) => piece.started);
  const offBoardFallback = getLowestLabelPiece(movablePieces.filter((piece) => !piece.started));
  return {
    selectedGroupPieceIds: [],
    pieceToMove: onBoardFallback ?? offBoardFallback,
    selectedPieceCanMove,
  };
}
