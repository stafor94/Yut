import type { BoardPiece } from '../../features/game/components/GameBoard';
import { getAiItemValue, type ItemType } from '../../features/items/logic/items';
import {
  BOARD_NODES,
  BRANCH_NODE_IDS,
  FINISH_NODE_ID,
  getMovePathNodeIdsWithPrevious,
  type BoardItem,
  type BranchChoice,
} from '../../game-core/board/board';
import { getRuntimeAiDifficultyForSeat, type AiDifficulty } from '../../game-core/aiDifficulty';
import { AI_SCORE_PROFILES, chooseScoredAiCandidate } from '../../game-core/aiStrategy';
import { GOLDEN_YUT_CHOICES, type YutResult } from '../../game-core/roll';
import type { Seat } from '../appState';
import { getEffectiveBranchChoice } from '../appUtils';
import { getAiRuntimeState } from './aiRuntimeState';

export { getAiItemValue };

export const getAiBranchChoice = (piece: BoardPiece): BranchChoice => (
  piece.started && BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? 'shortcut' : 'outer'
);

export type AiMoveContext = {
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  getSeatById: (seatId: string) => Seat | undefined;
  isSameSide: (left: Seat | undefined, right: Seat | undefined) => boolean;
  pieces: BoardPiece[];
  shieldedPieceIds?: readonly string[];
  trapNodeIds?: readonly string[];
  boardItems?: readonly BoardItem[];
};

export type AiMoveCandidate = {
  piece: BoardPiece;
  branchChoice: BranchChoice;
  score: number;
  projection: AiMoveProjection;
};

export type AiMoveProjection = {
  pathNodeIds: string[];
  destinationNodeId: string;
  landedNodeId: string;
  movingPieceIds: string[];
  movingPieceCount: number;
  finishedPieceCount: number;
  capturedPieceIds: string[];
  capturedPieceCount: number;
  shieldedCapturePieceIds: string[];
  mergedPieceCount: number;
  resultingGroupSize: number;
  reachesShortcutEntry: boolean;
  usesShortcut: boolean;
  remainingDistanceBefore: number;
  remainingDistance: number;
  threatBefore: number;
  threatAfter: number;
  threatReduction: number;
  hitsKnownTrap: boolean;
  collectedItemValue: number;
  startsNewPiece: boolean;
  winsImmediately: boolean;
};

export type AiStackedMovePlan = AiMoveCandidate & {
  roll: YutResult;
  rollStackIndex: number;
  plannedScore: number;
  search: {
    exploredNodes: number;
    maxDepth: number;
    nodeBudget: number;
    beamWidth: number;
    truncated: boolean;
  };
};

export type AiPlannerOptions = {
  maxDepth?: number;
  nodeBudget?: number;
  beamWidth?: number;
  futureDiscount?: number;
};

const SHORTCUT_ENTRY_IDS = new Set<string>(BRANCH_NODE_IDS);
const CAPTURE_STEPS = [1, 2, 3, 4, 5] as const;
const MAX_DISTANCE_SEARCH = 30;
const DEFAULT_NODE_BUDGET = 20_000;
const DEFAULT_BEAM_WIDTH = 18;
const DEFAULT_FUTURE_DISCOUNT = 0.82;
const LARGE_STACK_DEPTH_LIMIT = 4;
const LEGACY_STACK_SELECTED_SCORE_BONUS = 10_000_000;
const LEGACY_STACK_UNSELECTED_SCORE_PENALTY = 10_000_000;

const getSeatDifficulty = (seat: Seat): AiDifficulty => getRuntimeAiDifficultyForSeat(
  seat.id,
  seat as Seat & { aiDifficulty?: unknown },
);

function getLastPathNode(pathNodeIds: readonly string[], fallback: string) {
  return pathNodeIds.length > 0 ? pathNodeIds[pathNodeIds.length - 1] : fallback;
}

function getNodeIndex(nodeId: string) {
  return Math.max(0, BOARD_NODES.findIndex((node) => node.id === nodeId));
}

function getBranchChoicesForSteps(piece: BoardPiece, steps: number): BranchChoice[] {
  if (steps <= 0 || !piece.started || !SHORTCUT_ENTRY_IDS.has(piece.nodeId)) return ['outer'];
  return ['outer', 'shortcut'];
}

function getBranchChoices(piece: BoardPiece, result: YutResult): BranchChoice[] {
  return getBranchChoicesForSteps(piece, result.steps);
}

function getControlledGroup(piece: BoardPiece, seat: Seat, context: AiMoveContext) {
  if (!piece.started) return [piece];
  return context.pieces.filter((candidate) => (
    context.canSeatControlPiece(seat, candidate)
    && candidate.started
    && !candidate.finished
    && candidate.nodeId === piece.nodeId
  ));
}

function getMovableGroupRepresentatives(seat: Seat, result: YutResult, context: AiMoveContext) {
  const seenStartedNodes = new Set<string>();
  return [...context.pieces]
    .filter((piece) => context.canSeatControlPiece(seat, piece) && !piece.finished && (result.steps >= 0 || piece.started))
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((piece) => {
      if (!piece.started) return true;
      if (seenStartedNodes.has(piece.nodeId)) return false;
      seenStartedNodes.add(piece.nodeId);
      return true;
    });
}

function getMinimumRemainingDistance(nodeId: string, previousNodeId?: string) {
  if (nodeId === FINISH_NODE_ID) return 0;
  let frontier = new Map<string, { nodeId: string; previousNodeId?: string }>();
  frontier.set(`${nodeId}|${previousNodeId ?? ''}`, { nodeId, previousNodeId });
  for (let distance = 1; distance <= MAX_DISTANCE_SEARCH; distance += 1) {
    const nextFrontier = new Map<string, { nodeId: string; previousNodeId?: string }>();
    for (const state of frontier.values()) {
      const branches: BranchChoice[] = SHORTCUT_ENTRY_IDS.has(state.nodeId) ? ['outer', 'shortcut'] : ['outer'];
      for (const branchChoice of branches) {
        const path = getMovePathNodeIdsWithPrevious(state.nodeId, 1, branchChoice, state.previousNodeId);
        const nextNodeId = getLastPathNode(path, state.nodeId);
        if (nextNodeId === FINISH_NODE_ID) return distance;
        const nextState = { nodeId: nextNodeId, previousNodeId: state.nodeId };
        nextFrontier.set(`${nextState.nodeId}|${nextState.previousNodeId}`, nextState);
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }
  return MAX_DISTANCE_SEARCH + 1;
}

function canReachNodeInOneRoll(piece: BoardPiece, nodeId: string) {
  if (!piece.started || piece.finished || nodeId === FINISH_NODE_ID) return false;
  return CAPTURE_STEPS.some((steps) => getBranchChoicesForSteps(piece, steps).some((branchChoice) => {
    const effectiveBranchChoice = getEffectiveBranchChoice(piece.nodeId, branchChoice);
    const pathNodeIds = getMovePathNodeIdsWithPrevious(piece.nodeId, steps, effectiveBranchChoice, piece.previousNodeId);
    return getLastPathNode(pathNodeIds, piece.nodeId) === nodeId;
  }));
}

function getImmediateThreat(nodeId: string, vulnerablePieceCount: number, seat: Seat, context: AiMoveContext) {
  if (!nodeId || nodeId === FINISH_NODE_ID || vulnerablePieceCount <= 0) return 0;
  const threateningGroups = new Set<string>();
  for (const candidate of context.pieces) {
    const candidateSeat = context.getSeatById(candidate.ownerId);
    if (!candidate.started || candidate.finished || context.isSameSide(candidateSeat, seat)) continue;
    if (canReachNodeInOneRoll(candidate, nodeId)) threateningGroups.add(`${candidate.ownerId}:${candidate.nodeId}`);
  }
  return threateningGroups.size * vulnerablePieceCount;
}

function getSameSidePiecesAt(nodeId: string, seat: Seat, context: AiMoveContext, excludedIds: Set<string>) {
  if (nodeId === FINISH_NODE_ID) return [];
  return context.pieces.filter((candidate) => (
    !excludedIds.has(candidate.id)
    && context.canSeatControlPiece(seat, candidate)
    && candidate.started
    && !candidate.finished
    && candidate.nodeId === nodeId
  ));
}

function getEnemyPiecesAt(nodeId: string, seat: Seat, context: AiMoveContext, excludedIds: Set<string>) {
  if (nodeId === FINISH_NODE_ID) return [];
  return context.pieces.filter((candidate) => (
    !excludedIds.has(candidate.id)
    && candidate.started
    && !candidate.finished
    && candidate.nodeId === nodeId
    && !context.isSameSide(context.getSeatById(candidate.ownerId), seat)
  ));
}

export function projectAiMove(
  piece: BoardPiece,
  result: YutResult,
  seat: Seat,
  branchChoice: BranchChoice,
  context: AiMoveContext,
): AiMoveProjection | null {
  if (piece.finished || (result.steps < 0 && !piece.started) || !context.canSeatControlPiece(seat, piece)) return null;
  const effectiveBranchChoice = getEffectiveBranchChoice(piece.nodeId, branchChoice);
  const pathNodeIds = getMovePathNodeIdsWithPrevious(piece.nodeId, result.steps, effectiveBranchChoice, piece.previousNodeId);
  const destinationNodeId = getLastPathNode(pathNodeIds, piece.nodeId);
  const movingGroup = getControlledGroup(piece, seat, context);
  const movingPieceIds = movingGroup.map((candidate) => candidate.id);
  const movingIds = new Set(movingPieceIds);
  const finishes = destinationNodeId === FINISH_NODE_ID;
  const hitsKnownTrap = !finishes && (context.trapNodeIds ?? []).includes(destinationNodeId);
  const landedNodeId = hitsKnownTrap ? 'n01' : destinationNodeId;
  const shieldedIds = new Set(context.shieldedPieceIds ?? []);
  const enemyPieces = hitsKnownTrap ? [] : getEnemyPiecesAt(destinationNodeId, seat, context, movingIds);
  const shieldedCapturePieceIds = enemyPieces.filter((target) => shieldedIds.has(target.id)).map((target) => target.id);
  const capturedPieceIds = enemyPieces.filter((target) => !shieldedIds.has(target.id)).map((target) => target.id);
  const mergedPieces = hitsKnownTrap || finishes ? [] : getSameSidePiecesAt(destinationNodeId, seat, context, movingIds);
  const resultingGroupSize = hitsKnownTrap ? 0 : movingGroup.length + mergedPieces.length;
  const vulnerableBefore = movingGroup.filter((candidate) => !shieldedIds.has(candidate.id)).length;
  const vulnerableAfter = hitsKnownTrap ? 0 : movingGroup.filter((candidate) => !shieldedIds.has(candidate.id)).length + mergedPieces.filter((candidate) => !shieldedIds.has(candidate.id)).length;
  const remainingDistanceBefore = piece.finished ? 0 : getMinimumRemainingDistance(piece.nodeId, piece.previousNodeId);
  const remainingDistance = finishes ? 0 : hitsKnownTrap ? getMinimumRemainingDistance('n01') : getMinimumRemainingDistance(destinationNodeId, piece.nodeId);
  const ownPieces = context.pieces.filter((candidate) => context.canSeatControlPiece(seat, candidate));
  const ownFinishedCount = ownPieces.filter((candidate) => candidate.finished).length;
  const finishedPieceCount = finishes ? movingGroup.length : 0;
  const collectedItem = !hitsKnownTrap && !finishes ? (context.boardItems ?? []).find((item) => item.nodeId === destinationNodeId) : undefined;
  const threatBefore = getImmediateThreat(piece.nodeId, vulnerableBefore, seat, context);
  const capturedIds = new Set(capturedPieceIds);
  const postMoveThreatContext = hitsKnownTrap ? context : {
    ...context,
    pieces: context.pieces.map((candidate) => {
      if (movingIds.has(candidate.id)) {
        return { ...candidate, nodeId: destinationNodeId, previousNodeId: piece.nodeId, started: !finishes, finished: finishes };
      }
      if (capturedIds.has(candidate.id)) {
        return { ...candidate, nodeId: 'n01', previousNodeId: undefined, started: false, finished: false };
      }
      return candidate;
    }),
  };
  const threatAfter = finishes || hitsKnownTrap ? 0 : getImmediateThreat(destinationNodeId, vulnerableAfter, seat, postMoveThreatContext);
  return {
    pathNodeIds,
    destinationNodeId,
    landedNodeId,
    movingPieceIds,
    movingPieceCount: movingGroup.length,
    finishedPieceCount,
    capturedPieceIds,
    capturedPieceCount: capturedPieceIds.length,
    shieldedCapturePieceIds,
    mergedPieceCount: mergedPieces.length,
    resultingGroupSize,
    reachesShortcutEntry: !hitsKnownTrap && !finishes && SHORTCUT_ENTRY_IDS.has(destinationNodeId),
    usesShortcut: result.steps > 0 && effectiveBranchChoice === 'shortcut' && SHORTCUT_ENTRY_IDS.has(piece.nodeId),
    remainingDistanceBefore,
    remainingDistance,
    threatBefore,
    threatAfter,
    threatReduction: threatBefore - threatAfter,
    hitsKnownTrap,
    collectedItemValue: collectedItem ? getAiItemValue(collectedItem.type) : 0,
    startsNewPiece: !piece.started && result.steps > 0,
    winsImmediately: finishedPieceCount > 0 && ownFinishedCount + finishedPieceCount >= ownPieces.length,
  };
}

function scoreHardProjection(projection: AiMoveProjection) {
  const progress = projection.remainingDistanceBefore - projection.remainingDistance;
  const exposedStackPenalty = projection.threatAfter * Math.max(1, projection.resultingGroupSize) * 4_500;
  return (projection.winsImmediately ? 1_000_000 : 0)
    + projection.finishedPieceCount * 140_000
    + projection.capturedPieceCount * 55_000
    + (projection.capturedPieceCount > 0 ? 12_000 : 0)
    + (projection.reachesShortcutEntry ? 12_000 : 0)
    + (projection.usesShortcut ? 7_000 : 0)
    + projection.mergedPieceCount * 4_000
    + projection.threatReduction * 7_500
    + progress * 1_200
    + projection.collectedItemValue * 35
    + (projection.startsNewPiece ? 1_500 : 0)
    - exposedStackPenalty
    - (projection.hitsKnownTrap ? 240_000 * Math.max(1, projection.movingPieceCount) : 0)
    - projection.remainingDistance * 25;
}

export function scoreAiMove(
  piece: BoardPiece,
  result: YutResult,
  seat: Seat,
  aiBranchChoice: BranchChoice,
  context: AiMoveContext,
  difficulty = getSeatDifficulty(seat),
) {
  const projection = projectAiMove(piece, result, seat, aiBranchChoice, context);
  if (!projection) return Number.NEGATIVE_INFINITY;
  if (difficulty === 'hard') return scoreHardProjection(projection);
  const profile = AI_SCORE_PROFILES.easy;
  return (projection.finishedPieceCount ? profile.finish : 0)
    + (projection.capturedPieceCount ? profile.capture : 0)
    + (projection.usesShortcut ? profile.shortcut : 0)
    + (projection.startsNewPiece ? profile.start : 0)
    + projection.mergedPieceCount * profile.stack
    - projection.remainingDistance;
}

function compareMoveCandidates(left: AiMoveCandidate, right: AiMoveCandidate) {
  return right.score - left.score
    || Number(right.projection.winsImmediately) - Number(left.projection.winsImmediately)
    || right.projection.finishedPieceCount - left.projection.finishedPieceCount
    || right.projection.capturedPieceCount - left.projection.capturedPieceCount
    || left.projection.remainingDistance - right.projection.remainingDistance
    || right.projection.threatReduction - left.projection.threatReduction
    || left.piece.id.localeCompare(right.piece.id)
    || left.branchChoice.localeCompare(right.branchChoice);
}

function getEffectiveAiMoveContext(context: AiMoveContext): AiMoveContext {
  const runtimeState = getAiRuntimeState(context.pieces);
  if (!runtimeState) return context;
  return {
    ...context,
    shieldedPieceIds: context.shieldedPieceIds ?? runtimeState.shieldedPieceIds,
    trapNodeIds: context.trapNodeIds ?? runtimeState.trapNodeIds,
    boardItems: context.boardItems ?? runtimeState.boardItems,
  };
}

export function getAiMoveCandidates(seat: Seat, result: YutResult, context: AiMoveContext) {
  const effectiveContext = getEffectiveAiMoveContext(context);
  const difficulty = getSeatDifficulty(seat);
  return getMovableGroupRepresentatives(seat, result, effectiveContext)
    .flatMap((piece) => getBranchChoices(piece, result).flatMap((branchChoice) => {
      const projection = projectAiMove(piece, result, seat, branchChoice, effectiveContext);
      if (!projection) return [];
      return [{
        piece,
        branchChoice,
        projection,
        score: difficulty === 'hard' ? scoreHardProjection(projection) : scoreAiMove(piece, result, seat, branchChoice, effectiveContext, difficulty),
      }];
    }))
    .sort(compareMoveCandidates);
}

export function chooseAiMoveCandidate<T extends { score: number }>(candidates: T[], difficulty: AiDifficulty, random = Math.random) {
  return chooseScoredAiCandidate(candidates, difficulty, random);
}

type LegacyStackBatchEntry = {
  roll: YutResult;
  candidate: AiMoveCandidate | undefined;
  originalScore: number;
};

type LegacyStackBatch = {
  seat: Seat;
  context: AiMoveContext;
  entries: LegacyStackBatchEntry[];
  token: object;
};

let activeLegacyStackBatch: LegacyStackBatch | null = null;

function getLegacyStackBatch(seat: Seat, context: AiMoveContext) {
  if (activeLegacyStackBatch?.seat.id === seat.id && activeLegacyStackBatch.context.pieces === context.pieces) {
    return activeLegacyStackBatch;
  }
  const token = {};
  const batch: LegacyStackBatch = { seat, context, entries: [], token };
  activeLegacyStackBatch = batch;
  queueMicrotask(() => {
    if (activeLegacyStackBatch?.token === token) activeLegacyStackBatch = null;
  });
  return batch;
}

function applyLegacyStackPlan(batch: LegacyStackBatch) {
  if (batch.entries.length === 0) return;
  const plan = chooseAiStackedMove(batch.seat, batch.entries.map((entry) => entry.roll), batch.context);
  batch.entries.forEach((entry, index) => {
    if (!entry.candidate) return;
    entry.candidate.score = entry.originalScore - LEGACY_STACK_UNSELECTED_SCORE_PENALTY - index;
  });
  if (!plan) return;
  const selected = batch.entries[plan.rollStackIndex]?.candidate;
  if (!selected) return;
  selected.piece = plan.piece;
  selected.branchChoice = plan.branchChoice;
  selected.projection = plan.projection;
  selected.score = LEGACY_STACK_SELECTED_SCORE_BONUS + plan.plannedScore;
}

export function chooseAiMove(seat: Seat, result: YutResult, context: AiMoveContext, random = Math.random) {
  const effectiveContext = getEffectiveAiMoveContext(context);
  const difficulty = getSeatDifficulty(seat);
  const candidate = chooseAiMoveCandidate(getAiMoveCandidates(seat, result, effectiveContext), difficulty, random);
  if (difficulty !== 'hard') return candidate;
  const batch = getLegacyStackBatch(seat, effectiveContext);
  batch.entries.push({ roll: result, candidate, originalScore: candidate?.score ?? Number.NEGATIVE_INFINITY });
  applyLegacyStackPlan(batch);
  return candidate;
}

function applyProjectedMove(context: AiMoveContext, projection: AiMoveProjection): AiMoveContext {
  const movingIds = new Set(projection.movingPieceIds);
  const capturedIds = new Set(projection.capturedPieceIds);
  const shieldedIds = new Set(context.shieldedPieceIds ?? []);
  const nextShieldedIds = new Set(shieldedIds);
  let nextTrapNodeIds = [...(context.trapNodeIds ?? [])];
  let nextBoardItems = [...(context.boardItems ?? [])];
  if (projection.hitsKnownTrap) {
    nextTrapNodeIds = nextTrapNodeIds.filter((nodeId) => nodeId !== projection.destinationNodeId);
    projection.movingPieceIds.forEach((pieceId) => nextShieldedIds.delete(pieceId));
  }
  projection.shieldedCapturePieceIds.forEach((pieceId) => nextShieldedIds.delete(pieceId));
  if (!projection.hitsKnownTrap && projection.destinationNodeId !== FINISH_NODE_ID) {
    nextBoardItems = nextBoardItems.filter((item) => item.nodeId !== projection.destinationNodeId);
  }
  const nextPieces = context.pieces.map((candidate) => {
    if (movingIds.has(candidate.id)) {
      if (projection.hitsKnownTrap) {
        return { ...candidate, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: undefined };
      }
      const finished = projection.destinationNodeId === FINISH_NODE_ID;
      return {
        ...candidate,
        nodeIndex: finished ? 20 : getNodeIndex(projection.destinationNodeId),
        nodeId: projection.destinationNodeId,
        started: !finished,
        finished,
        previousNodeId: finished ? undefined : candidate.nodeId,
      };
    }
    if (capturedIds.has(candidate.id)) {
      return { ...candidate, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: undefined };
    }
    return candidate;
  });
  return {
    ...context,
    pieces: nextPieces,
    shieldedPieceIds: [...nextShieldedIds],
    trapNodeIds: nextTrapNodeIds,
    boardItems: nextBoardItems,
    canSeatControlPiece: context.canSeatControlPiece,
    getSeatById: context.getSeatById,
    isSameSide: context.isSameSide,
  };
}

type RemainingRoll = { roll: YutResult; originalIndex: number };
type SearchAction = AiMoveCandidate & { roll: YutResult; rollStackIndex: number };
type SearchResult = { score: number; action: SearchAction | null };

function serializePlannerState(context: AiMoveContext, remaining: readonly RemainingRoll[], depth: number) {
  const pieceState = [...context.pieces]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((piece) => `${piece.id}:${piece.nodeId}:${piece.previousNodeId ?? ''}:${Number(piece.started)}:${Number(piece.finished)}`)
    .join(',');
  return `${depth}|${remaining.map((entry) => `${entry.originalIndex}:${entry.roll.name}:${entry.roll.steps}`).join(',')}|${pieceState}|s:${[...(context.shieldedPieceIds ?? [])].sort().join(',')}|t:${[...(context.trapNodeIds ?? [])].sort().join(',')}|i:${[...(context.boardItems ?? [])].map((item) => `${item.id}:${item.nodeId}`).sort().join(',')}`;
}

function compareSearchActions(left: SearchAction, right: SearchAction) {
  return compareMoveCandidates(left, right)
    || left.rollStackIndex - right.rollStackIndex
    || left.roll.name.localeCompare(right.roll.name);
}

function compareSearchResults(left: { score: number; action: SearchAction }, right: { score: number; action: SearchAction }) {
  return right.score - left.score
    || Number(right.action.projection.winsImmediately) - Number(left.action.projection.winsImmediately)
    || right.action.projection.finishedPieceCount - left.action.projection.finishedPieceCount
    || right.action.projection.capturedPieceCount - left.action.projection.capturedPieceCount
    || left.action.projection.remainingDistance - right.action.projection.remainingDistance
    || right.action.projection.threatReduction - left.action.projection.threatReduction
    || left.action.rollStackIndex - right.action.rollStackIndex
    || left.action.piece.id.localeCompare(right.action.piece.id)
    || left.action.branchChoice.localeCompare(right.action.branchChoice);
}

export function chooseAiStackedMove(
  seat: Seat,
  rollStack: readonly YutResult[],
  context: AiMoveContext,
  random = Math.random,
  options: AiPlannerOptions = {},
): AiStackedMovePlan | null {
  if (rollStack.length === 0) return null;
  const effectiveContext = getEffectiveAiMoveContext(context);
  const difficulty = getSeatDifficulty(seat);
  if (difficulty === 'easy') {
    const candidates = rollStack.flatMap((stackRoll, rollStackIndex) => {
      const move = chooseAiMoveCandidate(getAiMoveCandidates(seat, stackRoll, effectiveContext), 'easy', random);
      return move ? [{ ...move, roll: stackRoll, rollStackIndex, plannedScore: move.score }] : [];
    }).sort((left, right) => compareMoveCandidates(left, right) || left.rollStackIndex - right.rollStackIndex);
    const chosen = chooseScoredAiCandidate(candidates, 'easy', random);
    return chosen ? {
      ...chosen,
      search: { exploredNodes: candidates.length, maxDepth: 1, nodeBudget: candidates.length, beamWidth: candidates.length, truncated: false },
    } : null;
  }

  const maxDepth = Math.max(1, Math.min(
    rollStack.length,
    options.maxDepth ?? (rollStack.length <= 4 ? rollStack.length : LARGE_STACK_DEPTH_LIMIT),
  ));
  const nodeBudget = Math.max(1, options.nodeBudget ?? DEFAULT_NODE_BUDGET);
  const beamWidth = Math.max(1, options.beamWidth ?? DEFAULT_BEAM_WIDTH);
  const futureDiscount = Math.min(1, Math.max(0, options.futureDiscount ?? DEFAULT_FUTURE_DISCOUNT));
  const memo = new Map<string, SearchResult>();
  let exploredNodes = 0;
  let truncated = maxDepth < rollStack.length;

  const search = (currentContext: AiMoveContext, remaining: RemainingRoll[], depth: number): SearchResult => {
    if (depth <= 0 || remaining.length === 0) return { score: 0, action: null };
    if (exploredNodes >= nodeBudget) {
      truncated = true;
      return { score: 0, action: null };
    }
    const memoKey = serializePlannerState(currentContext, remaining, depth);
    const memoized = memo.get(memoKey);
    if (memoized) return memoized;
    let actions = remaining.flatMap((entry) => getAiMoveCandidates(seat, entry.roll, currentContext).map((candidate) => ({
      ...candidate,
      roll: entry.roll,
      rollStackIndex: entry.originalIndex,
    })));
    actions.sort(compareSearchActions);
    if (actions.length > beamWidth) {
      actions = actions.slice(0, beamWidth);
      truncated = true;
    }
    if (actions.length === 0) {
      const empty = { score: 0, action: null };
      memo.set(memoKey, empty);
      return empty;
    }
    const evaluated: Array<{ score: number; action: SearchAction }> = [];
    for (const action of actions) {
      if (exploredNodes >= nodeBudget) {
        truncated = true;
        break;
      }
      exploredNodes += 1;
      const nextContext = applyProjectedMove(currentContext, action.projection);
      const nextRemaining = remaining.filter((entry) => entry.originalIndex !== action.rollStackIndex);
      const future = search(nextContext, nextRemaining, depth - 1);
      evaluated.push({ score: action.score + futureDiscount * future.score, action });
    }
    evaluated.sort(compareSearchResults);
    const best = evaluated[0] ?? { score: 0, action: null };
    const result: SearchResult = { score: best.score, action: best.action };
    memo.set(memoKey, result);
    return result;
  };

  const remaining = rollStack.map((stackRoll, originalIndex) => ({ roll: stackRoll, originalIndex }));
  const result = search(effectiveContext, remaining, maxDepth);
  if (!result.action) return null;
  return {
    ...result.action,
    plannedScore: result.score,
    search: { exploredNodes, maxDepth, nodeBudget, beamWidth, truncated },
  };
}

export function shouldAiUseReroll(seat: Seat, result: YutResult, context: AiMoveContext) {
  const move = getAiMoveCandidates(seat, result, context)[0];
  if (!move) return true;
  return result.steps <= 1 && move.score < AI_SCORE_PROFILES[getSeatDifficulty(seat)].rerollThreshold;
}

export function chooseAiGoldenYutResult(seat: Seat, context: AiMoveContext) {
  return [...GOLDEN_YUT_CHOICES]
    .map((choice) => ({ choice, move: getAiMoveCandidates(seat, choice, context)[0] }))
    .map(({ choice, move }) => ({ choice, score: move ? move.score + (choice.bonus ? 40 : 0) : Number.NEGATIVE_INFINITY }))
    .sort((left, right) => right.score - left.score)[0]?.choice ?? GOLDEN_YUT_CHOICES[GOLDEN_YUT_CHOICES.length - 1];
}

type ChooseAiAfterMoveItemInput = {
  adjustmentPiece: BoardPiece | undefined;
  items: ItemType[];
};

export function chooseAiAfterMoveItem({ adjustmentPiece, items }: ChooseAiAfterMoveItemInput) {
  const canUseTrapOrShield = Boolean(adjustmentPiece);
  if (items.includes('trap') && canUseTrapOrShield) return 'trap' as ItemType;
  if (items.includes('shield') && canUseTrapOrShield) return 'shield' as ItemType;
  return null;
}
