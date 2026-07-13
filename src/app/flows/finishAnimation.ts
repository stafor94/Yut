import { getBoardNodeById } from '../../game-core/board/board';

export type FinishAnimationPiece = {
  id: string;
  label: string;
  ownerId: string;
  color: string;
  nodeIndex: number;
  nodeId: string;
  started: boolean;
  finished: boolean;
  previousNodeId?: string;
};

export const FINISH_PAUSE_MS = 120;
export const FINISH_JUMP_MS = 620;
export const FINISH_ARRIVAL_MS = 180;
export const FINISH_STAGGER_MS = 70;
export const FINISH_EFFECT_MS = FINISH_PAUSE_MS + FINISH_JUMP_MS + FINISH_ARRIVAL_MS;

export type FinishVisualPiece = Pick<FinishAnimationPiece, 'id' | 'label' | 'color' | 'ownerId'> & {
  sourceLeft: number;
  sourceTop: number;
  targetLeft: number;
  targetTop: number;
  rotation: number;
  midRotation: number;
  delayMs: number;
};

export type FinishVisualEffect = {
  id: number;
  pieceIds: string[];
  pieces: FinishVisualPiece[];
  durationMs: number;
};

type Direction = { x: number; y: number };

const FINISH_SOURCE_NODE_ID = 'n01';
const EXIT_MIN = -12;
const EXIT_MAX = 118;

function normalizeDirection(direction: Direction, fallback: Direction = { x: 1, y: 0 }): Direction {
  const length = Math.hypot(direction.x, direction.y);
  if (length > 0.0001) return { x: direction.x / length, y: direction.y / length };
  const fallbackLength = Math.hypot(fallback.x, fallback.y) || 1;
  return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength };
}

function rotateDirection(direction: Direction, radians: number): Direction {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalizeDirection({
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  });
}

export function getFinishExitTarget(previousNodeId = 'n20', pieceIndex = 0, pieceCount = 1) {
  const source = getBoardNodeById(FINISH_SOURCE_NODE_ID);
  const previous = getBoardNodeById(previousNodeId) ?? getBoardNodeById('n20');
  if (!source || !previous) return { left: EXIT_MAX, top: 92, rotation: 240 };

  const centeredIndex = pieceIndex - (Math.max(1, pieceCount) - 1) / 2;
  const direction = rotateDirection(normalizeDirection({ x: source.x - previous.x, y: source.y - previous.y }), centeredIndex * 0.08);
  const distances = [
    direction.x > 0.0001 ? (EXIT_MAX - source.x) / direction.x : Number.POSITIVE_INFINITY,
    direction.x < -0.0001 ? (EXIT_MIN - source.x) / direction.x : Number.POSITIVE_INFINITY,
    direction.y > 0.0001 ? (EXIT_MAX - source.y) / direction.y : Number.POSITIVE_INFINITY,
    direction.y < -0.0001 ? (EXIT_MIN - source.y) / direction.y : Number.POSITIVE_INFINITY,
  ].filter((distance) => Number.isFinite(distance) && distance >= 0);
  const boundaryDistance = Math.min(...distances);
  const travelDistance = (Number.isFinite(boundaryDistance) ? boundaryDistance : 30) + 4 + pieceIndex * 2;

  return {
    left: Number((source.x + direction.x * travelDistance).toFixed(2)),
    top: Number((source.y + direction.y * travelDistance).toFixed(2)),
    rotation: Math.round((direction.y >= 0 ? 1 : -1) * (190 + pieceIndex * 34)),
  };
}

export function createFinishVisualEffect(params: {
  id: number;
  pieceIds: string[];
  previousPieces: FinishAnimationPiece[];
}): FinishVisualEffect | null {
  const finishingPieces = params.pieceIds
    .map((pieceId) => params.previousPieces.find((piece) => piece.id === pieceId))
    .filter((piece): piece is FinishAnimationPiece => Boolean(piece?.started && !piece.finished));
  const source = getBoardNodeById(FINISH_SOURCE_NODE_ID);
  if (!source || !finishingPieces.length) return null;

  const pieces = finishingPieces.map((piece, index) => {
    const target = getFinishExitTarget(piece.previousNodeId ?? 'n20', index, finishingPieces.length);
    return {
      id: piece.id,
      label: piece.label,
      color: piece.color,
      ownerId: piece.ownerId,
      sourceLeft: source.x,
      sourceTop: source.y,
      targetLeft: target.left,
      targetTop: target.top,
      rotation: target.rotation,
      midRotation: Math.round(target.rotation * 0.28),
      delayMs: index * FINISH_STAGGER_MS,
    };
  });

  return {
    id: params.id,
    pieceIds: pieces.map((piece) => piece.id),
    pieces,
    durationMs: FINISH_EFFECT_MS + Math.max(0, pieces.length - 1) * FINISH_STAGGER_MS,
  };
}

export function inferFinishedPieceIds(params: {
  previousPieces: FinishAnimationPiece[];
  pieces: FinishAnimationPiece[];
}) {
  const currentById = new Map(params.pieces.map((piece) => [piece.id, piece]));
  return params.previousPieces
    .filter((previousPiece) => {
      const currentPiece = currentById.get(previousPiece.id);
      return Boolean(previousPiece.started && !previousPiece.finished && currentPiece?.finished);
    })
    .map((piece) => piece.id);
}
