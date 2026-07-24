import { FINISH_NODE_ID, getAdjacentBoardNodeIds } from '../../game-core/board/board';

export type MovePresentationPiece = {
  id: string;
  nodeId: string;
  started: boolean;
  finished: boolean;
  previousNodeId?: string;
};

export type MovePresentationSession<TPiece extends MovePresentationPiece> = {
  pieceId: string;
  movingGroupIds: string[];
  lastNodeId: string;
  acceptedPieces: TPiece[];
  acceptedFrameKey: string;
};

const clonePieces = <TPiece extends MovePresentationPiece>(pieces: TPiece[]) => pieces.map((piece) => ({ ...piece }));

export function getMovePresentationFrameKey<TPiece extends MovePresentationPiece>(pieces: TPiece[]) {
  return pieces
    .map((piece) => `${piece.id}:${piece.nodeId}:${piece.started ? 1 : 0}:${piece.finished ? 1 : 0}:${piece.previousNodeId ?? ''}`)
    .join('|');
}

export function createMovePresentationSession<TPiece extends MovePresentationPiece>(
  pieces: TPiece[],
  movingPieceId: string,
  getPieceSideKey: (piece: TPiece) => string,
): MovePresentationSession<TPiece> | null {
  const movingPiece = pieces.find((piece) => piece.id === movingPieceId);
  if (!movingPiece) return null;

  const sideKey = getPieceSideKey(movingPiece);
  const movingGroupIds = movingPiece.started
    ? pieces
      .filter((piece) => piece.started && !piece.finished && piece.nodeId === movingPiece.nodeId && getPieceSideKey(piece) === sideKey)
      .map((piece) => piece.id)
    : [movingPiece.id];

  return {
    pieceId: movingPieceId,
    movingGroupIds,
    lastNodeId: movingPiece.nodeId,
    acceptedPieces: clonePieces(pieces),
    acceptedFrameKey: '',
  };
}

export function isSequentialMovePresentationNode(previousNodeId: string, nextNodeId: string) {
  if (!previousNodeId || !nextNodeId) return false;
  if (previousNodeId === nextNodeId) return true;
  if (previousNodeId === 'n01' && nextNodeId === FINISH_NODE_ID) return true;
  if (previousNodeId === FINISH_NODE_ID) return false;
  return getAdjacentBoardNodeIds(previousNodeId).includes(nextNodeId);
}

export function acceptMovePresentationFrame<TPiece extends MovePresentationPiece>(
  session: MovePresentationSession<TPiece>,
  incomingPieces: TPiece[],
) {
  const incomingMovingPiece = incomingPieces.find((piece) => piece.id === session.pieceId);
  if (!incomingMovingPiece || !isSequentialMovePresentationNode(session.lastNodeId, incomingMovingPiece.nodeId)) {
    return { accepted: false as const, session };
  }

  const incomingById = new Map(incomingPieces.map((piece) => [piece.id, piece]));
  const movingGroupIdSet = new Set(session.movingGroupIds);
  const acceptedPieces = session.acceptedPieces.map((piece) => {
    if (!movingGroupIdSet.has(piece.id)) return { ...piece };
    const incomingPiece = incomingById.get(piece.id);
    return incomingPiece ? { ...incomingPiece } : { ...piece };
  });
  const acceptedFrameKey = getMovePresentationFrameKey(acceptedPieces);

  return {
    accepted: true as const,
    changed: acceptedFrameKey !== session.acceptedFrameKey,
    pieces: acceptedPieces,
    frameKey: acceptedFrameKey,
    session: {
      ...session,
      lastNodeId: incomingMovingPiece.nodeId,
      acceptedPieces,
      acceptedFrameKey,
    },
  };
}

export function getCapturePresentationSignature(effect: { nodeId: string; pieceIds: string[] }) {
  return `${effect.nodeId}:${[...effect.pieceIds].sort().join(',')}`;
}
