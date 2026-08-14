export type CaptureAnimationPiece = {
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

import { getBoardNodeById } from '../../game-core/board/board';
import { localMoveLedger, type LocalMoveLedgerRecord } from './localMoveOwnership';

export const CAPTURE_SLOW_MOTION_MS = 320;
export const CAPTURE_IMPACT_DELAY_MS = 80;
export const CAPTURE_FLIGHT_MS = 640;
export const CAPTURE_EFFECT_MS = CAPTURE_IMPACT_DELAY_MS + CAPTURE_FLIGHT_MS;

export function getCaptureStaggerMs(pieceCount: number) {
  if (pieceCount <= 1) return 0;
  if (pieceCount === 2) return 90;
  if (pieceCount === 3) return 75;
  return 60;
}

export function getCaptureEffectDurationMs(pieceCount: number) {
  return CAPTURE_EFFECT_MS + Math.max(0, pieceCount - 1) * getCaptureStaggerMs(pieceCount);
}

export type CaptureMotionProfile = {
  arcBaseHeight: number;
  arcStepHeight: number;
  attackerJumpX: number;
  attackerJumpY: number;
  attackerSettleX: number;
  attackerSettleY: number;
  shakePrimaryX: number;
  shakePrimaryY: number;
  shakePrimaryRotation: number;
  shakeSecondaryX: number;
  shakeSecondaryY: number;
  shakeSecondaryRotation: number;
  shakeTertiaryX: number;
  shakeTertiaryY: number;
  shakeTertiaryRotation: number;
};

const CAPTURE_MOTION_PROFILES: Record<1 | 2 | 3 | 4, CaptureMotionProfile> = {
  1: {
    arcBaseHeight: 22,
    arcStepHeight: 4,
    attackerJumpX: -7,
    attackerJumpY: -2,
    attackerSettleX: 3,
    attackerSettleY: 1,
    shakePrimaryX: 5,
    shakePrimaryY: 2,
    shakePrimaryRotation: 0.35,
    shakeSecondaryX: 3,
    shakeSecondaryY: 1,
    shakeSecondaryRotation: 0.2,
    shakeTertiaryX: 2,
    shakeTertiaryY: 1,
    shakeTertiaryRotation: 0.15,
  },
  2: {
    arcBaseHeight: 34,
    arcStepHeight: 5,
    attackerJumpX: -9,
    attackerJumpY: -16,
    attackerSettleX: 4,
    attackerSettleY: 2,
    shakePrimaryX: 7,
    shakePrimaryY: 3,
    shakePrimaryRotation: 0.5,
    shakeSecondaryX: 4,
    shakeSecondaryY: 2,
    shakeSecondaryRotation: 0.3,
    shakeTertiaryX: 3,
    shakeTertiaryY: 1.5,
    shakeTertiaryRotation: 0.22,
  },
  3: {
    arcBaseHeight: 46,
    arcStepHeight: 6,
    attackerJumpX: -11,
    attackerJumpY: -24,
    attackerSettleX: 5,
    attackerSettleY: 2,
    shakePrimaryX: 10,
    shakePrimaryY: 4,
    shakePrimaryRotation: 0.75,
    shakeSecondaryX: 6,
    shakeSecondaryY: 2,
    shakeSecondaryRotation: 0.45,
    shakeTertiaryX: 4,
    shakeTertiaryY: 2,
    shakeTertiaryRotation: 0.32,
  },
  4: {
    arcBaseHeight: 58,
    arcStepHeight: 7,
    attackerJumpX: -14,
    attackerJumpY: -34,
    attackerSettleX: 7,
    attackerSettleY: 3,
    shakePrimaryX: 14,
    shakePrimaryY: 6,
    shakePrimaryRotation: 1,
    shakeSecondaryX: 8,
    shakeSecondaryY: 3,
    shakeSecondaryRotation: 0.6,
    shakeTertiaryX: 6,
    shakeTertiaryY: 2.5,
    shakeTertiaryRotation: 0.45,
  },
};

export function getCaptureMotionProfile(pieceCount: number) {
  const level = Math.min(4, Math.max(1, Math.round(pieceCount))) as 1 | 2 | 3 | 4;
  return CAPTURE_MOTION_PROFILES[level];
}

export function getCaptureArcHeightPx(pieceCount: number, pieceIndex = 0) {
  const profile = getCaptureMotionProfile(pieceCount);
  return -(profile.arcBaseHeight + Math.max(0, pieceIndex) * profile.arcStepHeight);
}

export type CaptureVisualPiece = Pick<CaptureAnimationPiece, 'id' | 'label' | 'color' | 'ownerId'> & {
  sourceLeft: number;
  sourceTop: number;
  targetLeft: number;
  targetTop: number;
  rotation: number;
  midRotation: number;
  delayMs: number;
  arcHeight: number;
  endScale: number;
};

export type CaptureVisualEffect = {
  id: number;
  presentationKey: string;
  nodeId: string;
  pieceIds: string[];
  pieces: CaptureVisualPiece[];
  attackerPieceIds: string[];
  pieceCount: number;
  durationMs: number;
};

type Direction = { x: number; y: number };

const BOARD_CENTER = 50;
const EXIT_MIN = -14;
const EXIT_MAX = 114;
const EXIT_OVERSHOOT = 6;

const isResetAtStart = (piece: unknown) => {
  if (!piece || typeof piece !== 'object' || Array.isArray(piece)) return false;
  const candidate = piece as Partial<CaptureAnimationPiece>;
  return candidate.nodeId === 'n01' && candidate.started === false && candidate.finished === false;
};

const getRecordFinalPiece = (record: LocalMoveLedgerRecord, pieceId: string) => record.finalPieces.find((piece) => (
  piece && typeof piece === 'object' && !Array.isArray(piece) && (piece as { id?: unknown }).id === pieceId
));

const getMatchingActiveLocalCaptureRecord = (
  pieceIds: string[],
  capturedPieces: CaptureAnimationPiece[],
): LocalMoveLedgerRecord | null => {
  const record = localMoveLedger.findActive();
  if (!record?.clientMutationId || !record.pieceId || !record.toNodeId || !pieceIds.length) return null;
  if (pieceIds.length !== capturedPieces.length) return null;
  const requestedIds = [...pieceIds].sort();
  const sourceIds = capturedPieces.map((piece) => piece.id).sort();
  if (requestedIds.some((pieceId, index) => pieceId !== sourceIds[index])) return null;
  if (capturedPieces.some((piece) => (
    record.movingGroupIds.includes(piece.id)
    || !piece.started
    || piece.finished
    || piece.nodeId !== record.toNodeId
    || !isResetAtStart(getRecordFinalPiece(record, piece.id))
  ))) return null;
  const finalAttacker = getRecordFinalPiece(record, record.pieceId) as Partial<CaptureAnimationPiece> | undefined;
  if (!finalAttacker?.started || finalAttacker.finished || finalAttacker.nodeId !== record.toNodeId) return null;
  return record;
};

function inferActiveLocalCapturedPieceIds(params: {
  pieces: CaptureAnimationPiece[];
  attackerPieceId?: string;
  getPieceGroupKey: (piece: CaptureAnimationPiece) => string;
}) {
  const record = localMoveLedger.findActive();
  if (!record?.clientMutationId || !record.pieceId || !record.toNodeId) return [];
  if (params.attackerPieceId && params.attackerPieceId !== record.pieceId) return [];
  const attacker = params.pieces.find((piece) => piece.id === record.pieceId);
  if (!attacker?.started || attacker.finished || attacker.nodeId !== record.toNodeId) return [];
  const attackerSideKey = params.getPieceGroupKey(attacker);
  return params.pieces
    .filter((piece) => (
      !record.movingGroupIds.includes(piece.id)
      && piece.started
      && !piece.finished
      && piece.nodeId === record.toNodeId
      && params.getPieceGroupKey(piece) !== attackerSideKey
      && isResetAtStart(getRecordFinalPiece(record, piece.id))
    ))
    .map((piece) => piece.id);
}

function normalizeDirection(direction: Direction, fallback: Direction = { x: 1, y: -1 }): Direction {
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

function getBaseEjectionDirection(nodeId: string, previousNodeId?: string): Direction {
  const node = getBoardNodeById(nodeId);
  if (!node) return normalizeDirection({ x: 1, y: -1 });

  const radial = normalizeDirection({ x: node.x - BOARD_CENTER, y: node.y - BOARD_CENTER });
  const previousNode = previousNodeId ? getBoardNodeById(previousNodeId) : undefined;
  const incoming = previousNode
    ? normalizeDirection({ x: node.x - previousNode.x, y: node.y - previousNode.y }, radial)
    : radial;
  const distanceFromCenter = Math.hypot(node.x - BOARD_CENTER, node.y - BOARD_CENTER);

  if (distanceFromCenter < 4) return incoming;
  const radialWeight = distanceFromCenter >= 38 ? 0.88 : 0.62;
  return normalizeDirection({
    x: radial.x * radialWeight + incoming.x * (1 - radialWeight),
    y: radial.y * radialWeight + incoming.y * (1 - radialWeight),
  }, radial);
}

export function getCaptureExitTarget(nodeId: string, previousNodeId = '', pieceIndex = 0, pieceCount = 1) {
  const node = getBoardNodeById(nodeId);
  if (!node) return { left: EXIT_MAX, top: EXIT_MIN, rotation: 280 };

  const centeredIndex = pieceIndex - (Math.max(1, pieceCount) - 1) / 2;
  const fanRadians = centeredIndex * 0.17;
  const direction = rotateDirection(getBaseEjectionDirection(nodeId, previousNodeId), fanRadians);
  const distances = [
    direction.x > 0.0001 ? (EXIT_MAX - node.x) / direction.x : Number.POSITIVE_INFINITY,
    direction.x < -0.0001 ? (EXIT_MIN - node.x) / direction.x : Number.POSITIVE_INFINITY,
    direction.y > 0.0001 ? (EXIT_MAX - node.y) / direction.y : Number.POSITIVE_INFINITY,
    direction.y < -0.0001 ? (EXIT_MIN - node.y) / direction.y : Number.POSITIVE_INFINITY,
  ].filter((distance) => Number.isFinite(distance) && distance >= 0);
  const boundaryDistance = Math.min(...distances);
  const travelDistance = (Number.isFinite(boundaryDistance) ? boundaryDistance : 72) + EXIT_OVERSHOOT + pieceIndex * 5;
  const rotationDirection = direction.x >= 0 ? 1 : -1;

  return {
    left: Number((node.x + direction.x * travelDistance).toFixed(2)),
    top: Number((node.y + direction.y * travelDistance).toFixed(2)),
    rotation: Math.round(rotationDirection * (250 + pieceIndex * 64 + Math.abs(centeredIndex) * 24)),
  };
}

export function createCaptureVisualEffect(params: {
  id: number;
  presentationKey?: string;
  pieceIds: string[];
  pieces: CaptureAnimationPiece[];
  attackerPieceId?: string;
  getPieceGroupKey: (piece: CaptureAnimationPiece) => string;
}): CaptureVisualEffect | null {
  const pieceIdSet = new Set(params.pieceIds);
  const capturedPieces = params.pieceIds
    .map((pieceId) => params.pieces.find((piece) => piece.id === pieceId))
    .filter((piece): piece is CaptureAnimationPiece => Boolean(piece && piece.nodeId && piece.nodeId !== 'finish'));

  if (!capturedPieces.length) return null;

  const localCaptureRecord = getMatchingActiveLocalCaptureRecord(params.pieceIds, capturedPieces);
  const nodeId = capturedPieces[0].nodeId;
  const capturedSideKey = params.getPieceGroupKey(capturedPieces[0]);
  const effectiveAttackerPieceId = params.attackerPieceId || localCaptureRecord?.pieceId;
  const attacker = params.pieces.find((piece) => piece.id === effectiveAttackerPieceId && piece.started && !piece.finished)
    ?? params.pieces.find((piece) => !pieceIdSet.has(piece.id)
      && piece.started
      && !piece.finished
      && piece.nodeId === nodeId
      && params.getPieceGroupKey(piece) !== capturedSideKey);
  const localPreviousNodeId = localCaptureRecord
    ? localCaptureRecord.pathNodeIds[localCaptureRecord.pathNodeIds.length - 2] ?? localCaptureRecord.fromNodeId
    : '';
  const previousNodeId = localPreviousNodeId || attacker?.previousNodeId || '';
  const attackerSideKey = attacker ? params.getPieceGroupKey(attacker) : '';
  const attackerPieceIds = localCaptureRecord
    ? localCaptureRecord.movingGroupIds.filter((pieceId) => !pieceIdSet.has(pieceId))
    : attackerSideKey
      ? params.pieces
        .filter((piece) => !pieceIdSet.has(piece.id)
          && piece.started
          && !piece.finished
          && piece.nodeId === nodeId
          && params.getPieceGroupKey(piece) === attackerSideKey)
        .map((piece) => piece.id)
      : [];
  const node = getBoardNodeById(nodeId);
  if (!node) return null;

  const staggerMs = getCaptureStaggerMs(capturedPieces.length);
  const pieces = capturedPieces.map((piece, index) => {
    const target = getCaptureExitTarget(nodeId, previousNodeId, index, capturedPieces.length);
    return {
      id: piece.id,
      label: piece.label,
      color: piece.color,
      ownerId: piece.ownerId,
      sourceLeft: node.x,
      sourceTop: node.y,
      targetLeft: target.left,
      targetTop: target.top,
      rotation: target.rotation,
      midRotation: Math.round(target.rotation * 0.28),
      delayMs: index * staggerMs,
      arcHeight: getCaptureArcHeightPx(capturedPieces.length, index),
      endScale: Number((0.68 + (index === capturedPieces.length - 1 ? 0.1 : index * 0.02)).toFixed(2)),
    };
  });
  const requestedPresentationKey = params.presentationKey
    || `capture-effect:${params.id}:${[...params.pieceIds].sort().join(',')}`;
  const activeLocalMoveKey = localCaptureRecord?.clientMutationId
    ?? (requestedPresentationKey.startsWith('capture-effect:')
      ? localMoveLedger.findActive()?.clientMutationId ?? ''
      : '');

  return {
    id: params.id,
    presentationKey: activeLocalMoveKey || requestedPresentationKey,
    nodeId,
    pieceIds: pieces.map((piece) => piece.id),
    pieces,
    attackerPieceIds,
    pieceCount: pieces.length,
    durationMs: getCaptureEffectDurationMs(pieces.length),
  };
}

export function inferCapturedPieceIds(params: {
  previousPieces: CaptureAnimationPiece[];
  pieces: CaptureAnimationPiece[];
  attackerPieceId?: string;
  getPieceGroupKey: (piece: CaptureAnimationPiece) => string;
}) {
  const localCapturedPieceIds = inferActiveLocalCapturedPieceIds({
    pieces: params.pieces,
    attackerPieceId: params.attackerPieceId,
    getPieceGroupKey: params.getPieceGroupKey,
  });
  if (localCapturedPieceIds.length) return localCapturedPieceIds;
  if (!params.attackerPieceId) return [];

  const previousById = new Map(params.previousPieces.map((piece) => [piece.id, piece]));
  const attacker = params.pieces.find((piece) => piece.id === params.attackerPieceId);
  const previousAttacker = previousById.get(params.attackerPieceId);
  if (!attacker?.started || attacker.finished || !previousAttacker) return [];

  const attackerSideKey = params.getPieceGroupKey(attacker);
  return params.previousPieces
    .filter((previousPiece) => {
      if (previousPiece.id === attacker.id || !previousPiece.started || previousPiece.finished) return false;
      if (previousPiece.nodeId !== attacker.nodeId) return false;
      if (params.getPieceGroupKey(previousPiece) === attackerSideKey) return false;
      const currentPiece = params.pieces.find((piece) => piece.id === previousPiece.id);
      return Boolean(currentPiece
        && !currentPiece.started
        && !currentPiece.finished
        && currentPiece.nodeId === 'n01');
    })
    .map((piece) => piece.id);
}
