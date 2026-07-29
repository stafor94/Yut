import type { BoardPiece } from '../../features/game/components/GameBoard';
import { getAiItemValue, type ItemType } from '../../features/items/logic/items';
import { BRANCH_NODE_IDS, FINISH_NODE_ID, getMovePathNodeIdsWithPrevious, type BranchChoice } from '../../game-core/board/board';
import { getRuntimeAiDifficultyForSeat, type AiDifficulty } from '../../game-core/aiDifficulty';
import { AI_SCORE_PROFILES, chooseScoredAiCandidate } from '../../game-core/aiStrategy';
import type { YutResult } from '../../game-core/roll';
import { GOLDEN_YUT_CHOICES } from '../../game-core/roll';
import type { Seat } from '../appState';
import { getEffectiveBranchChoice } from '../appUtils';

export { getAiItemValue };

export const getAiBranchChoice = (piece: BoardPiece): BranchChoice => piece.started && BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? 'shortcut' : 'outer';

export type AiMoveContext = {
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  getSeatById: (seatId: string) => Seat | undefined;
  isSameSide: (left: Seat | undefined, right: Seat | undefined) => boolean;
  pieces: BoardPiece[];
  shieldedPieceIds?: string[];
  trapNodeIds?: string[];
  boardItems?: Array<{ nodeId: string; type: ItemType }>;
};

export type AiMoveProjection = {
  pathNodeIds: string[];
  landedNodeId: string;
  movingPieceCount: number;
  finishedPieceCount: number;
  capturedPieceCount: number;
  mergedPieceCount: number;
  resultingGroupSize: number;
  reachesShortcutEntry: boolean;
  usesShortcut: boolean;
  remainingDistance: number;
  threatBefore: number;
  threatAfter: number;
  hitsKnownTrap: boolean;
  itemValue: number;
};

export type AiMoveCandidate = {
  piece: BoardPiece;
  branchChoice: BranchChoice;
  score: number;
  projection?: AiMoveProjection;
};

export type AiStackedPlanAction = AiMoveCandidate & {
  roll: YutResult;
  rollStackIndex: number;
};

export type AiStackedMovePlan = {
  action: AiStackedPlanAction;
  actions: AiStackedPlanAction[];
  totalScore: number;
  exploredNodes: number;
  limited: boolean;
};

type PlannerContext = AiMoveContext & {
  shieldedPieceIds: string[];
  trapNodeIds: string[];
  boardItems: Array<{ nodeId: string; type: ItemType }>;
};

type PlannerState = {
  context: PlannerContext;
};

type PlannerSearchResult = {
  actions: AiStackedPlanAction[];
  score: number;
};

const SHORTCUT_ENTRY_IDS = new Set(['n06', 'n11', 'c01']);
const CAPTURE_STEPS = [1, 2, 3, 4, 5] as const;
const DEFAULT_PLANNER_DEPTH = 6;
const DEFAULT_PLANNER_BEAM_WIDTH = 10;
const DEFAULT_PLANNER_NODE_LIMIT = 500;
const FUTURE_SCORE_DISCOUNT = 0.9;

const getSeatDifficulty = (seat: Seat): AiDifficulty => getRuntimeAiDifficultyForSeat(
  seat.id,
  seat as Seat & { aiDifficulty?: unknown },
);

function readRuntimeDebugContext() {
  if (typeof window === 'undefined') return null;
  const state = (window as typeof window & { __YUT_DEBUG_STATE__?: Record<string, unknown> }).__YUT_DEBUG_STATE__;
  if (!state) return null;
  const shieldedPieceIds = Array.isArray(state.shieldedPieceIds) ? state.shieldedPieceIds.filter((id): id is string => typeof id === 'string') : [];
  const trapNodeIds = Array.isArray(state.trapNodes)
    ? state.trapNodes.map((trap) => typeof trap === 'object' && trap && 'nodeId' in trap ? String((trap as { nodeId?: unknown }).nodeId ?? '') : '').filter(Boolean)
    : [];
  const boardItems = Array.isArray(state.boardItems)
    ? state.boardItems.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const nodeId = String((item as { nodeId?: unknown }).nodeId ?? '');
      const type = String((item as { type?: unknown }).type ?? '') as ItemType;
      return nodeId && ['reroll', 'move_plus_one', 'move_minus_one', 'shield', 'trap', 'golden_yut'].includes(type) ? [{ nodeId, type }] : [];
    })
    : [];
  return { shieldedPieceIds, trapNodeIds, boardItems };
}

function resolveAiMoveContext(context: AiMoveContext): PlannerContext {
  const runtime = readRuntimeDebugContext();
  return {
    ...context,
    shieldedPieceIds: context.shieldedPieceIds ?? runtime?.shieldedPieceIds ?? [],
    trapNodeIds: context.trapNodeIds ?? runtime?.trapNodeIds ?? [],
    boardItems: context.boardItems ?? runtime?.boardItems ?? [],
  };
}

function getControlledGroup(piece: BoardPiece, seat: Seat, context: AiMoveContext) {
  if (!piece.started) return [piece];
  return context.pieces.filter((candidate) => context.canSeatControlPiece(seat, candidate) && candidate.started && !candidate.finished && candidate.nodeId === piece.nodeId);
}

function getLastPathNode(pathNodeIds: string[], fallback: string) {
  return pathNodeIds.length > 0 ? pathNodeIds[pathNodeIds.length - 1] : fallback;
}

function canReachNodeInOneRoll(piece: BoardPiece, nodeId: string) {
  if (!piece.started || piece.finished) return false;
  return CAPTURE_STEPS.some((steps) => {
    const branches: BranchChoice[] = BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? ['outer', 'shortcut'] : ['outer'];
    return branches.some((branchChoice) => {
      const pathNodeIds = getMovePathNodeIdsWithPrevious(piece.nodeId, steps, getEffectiveBranchChoice(piece.nodeId, branchChoice), piece.previousNodeId);
      return getLastPathNode(pathNodeIds, piece.nodeId) === nodeId;
    });
  });
}

function getImmediateThreat(nodeId: string, movingGroupSize: number, seat: Seat, context: AiMoveContext) {
  if (!nodeId || nodeId === FINISH_NODE_ID) return 0;
  const threateningPieces = context.pieces.filter((candidate) => {
    if (!candidate.started || candidate.finished || context.isSameSide(context.getSeatById(candidate.ownerId), seat)) return false;
    return canReachNodeInOneRoll(candidate, nodeId);
  }).length;
  return threateningPieces * Math.max(1, movingGroupSize);
}

function getRemainingDistance(nodeId: string, previousNodeId?: string) {
  if (nodeId === FINISH_NODE_ID) return 0;
  for (let steps = 1; steps <= 25; steps += 1) {
    const branches: BranchChoice[] = SHORTCUT_ENTRY_IDS.has(nodeId) ? ['shortcut', 'outer'] : ['outer'];
    if (branches.some((branchChoice) => getMovePathNodeIdsWithPrevious(nodeId, steps, branchChoice, previousNodeId).includes(FINISH_NODE_ID))) return steps;
  }
  return 26;
}

export function projectAiMove(piece: BoardPiece, result: YutResult, seat: Seat, branchChoice: BranchChoice, inputContext: AiMoveContext): AiMoveProjection | null {
  const context = resolveAiMoveContext(inputContext);
  if (piece.finished || (result.steps < 0 && !piece.started)) return null;
  const effectiveBranchChoice = getEffectiveBranchChoice(piece.nodeId, branchChoice);
  const pathNodeIds = getMovePathNodeIdsWithPrevious(piece.nodeId, result.steps, effectiveBranchChoice, piece.previousNodeId);
  const landedNodeId = getLastPathNode(pathNodeIds, piece.nodeId);
  const movingGroup = getControlledGroup(piece, seat, context);
  const finishes = landedNodeId === FINISH_NODE_ID;
  const shieldedPieceIds = new Set(context.shieldedPieceIds);
  const capturedPieces = finishes ? [] : context.pieces.filter((target) => (
    !context.isSameSide(context.getSeatById(target.ownerId), seat)
    && target.started
    && !target.finished
    && target.nodeId === landedNodeId
    && !shieldedPieceIds.has(target.id)
  ));
  const mergedPieces = finishes ? [] : context.pieces.filter((target) => (
    context.canSeatControlPiece(seat, target)
    && target.started
    && !target.finished
    && target.nodeId === landedNodeId
    && !movingGroup.some((movingPiece) => movingPiece.id === target.id)
  ));
  const resultingGroupSize = movingGroup.length + mergedPieces.length;
  const landedItem = finishes ? undefined : context.boardItems.find((item) => item.nodeId === landedNodeId);
  return {
    pathNodeIds,
    landedNodeId,
    movingPieceCount: movingGroup.length,
    finishedPieceCount: finishes ? movingGroup.length : 0,
    capturedPieceCount: capturedPieces.length,
    mergedPieceCount: mergedPieces.length,
    resultingGroupSize,
    reachesShortcutEntry: !finishes && SHORTCUT_ENTRY_IDS.has(landedNodeId),
    usesShortcut: result.steps > 0 && effectiveBranchChoice === 'shortcut' && SHORTCUT_ENTRY_IDS.has(piece.nodeId),
    remainingDistance: finishes ? 0 : getRemainingDistance(landedNodeId, piece.nodeId),
    threatBefore: getImmediateThreat(piece.nodeId, movingGroup.length, seat, context),
    threatAfter: getImmediateThreat(landedNodeId, resultingGroupSize, seat, context),
    hitsKnownTrap: !finishes && context.trapNodeIds.includes(landedNodeId),
    itemValue: landedItem ? getAiItemValue(landedItem.type) : 0,
  };
}

function scoreHardProjection(piece: BoardPiece, projection: AiMoveProjection, context: AiMoveContext) {
  const ownerSeat = context.getSeatById(piece.ownerId);
  const ownFinishedCount = context.pieces.filter((candidate) => context.canSeatControlPiece(ownerSeat, candidate) && candidate.finished).length;
  const totalOwnCount = context.pieces.filter((candidate) => context.canSeatControlPiece(ownerSeat, candidate)).length;
  const winsImmediately = projection.finishedPieceCount > 0 && ownFinishedCount + projection.finishedPieceCount >= totalOwnCount;
  const threatDelta = projection.threatBefore - projection.threatAfter;
  return (winsImmediately ? 1_000_000 : 0)
    + projection.finishedPieceCount * 20_000
    + projection.capturedPieceCount * 5_000
    + (projection.capturedPieceCount > 0 ? 600 : 0)
    + (projection.reachesShortcutEntry ? 650 : 0)
    + (projection.usesShortcut ? 400 : 0)
    + projection.mergedPieceCount * 220
    + threatDelta * 180
    - projection.threatAfter * projection.resultingGroupSize * 110
    - projection.remainingDistance * 20
    - (projection.hitsKnownTrap ? 50_000 : 0)
    + projection.itemValue * 3
    + (piece.started ? 0 : 80);
}

export function scoreAiMove(piece: BoardPiece, result: YutResult, seat: Seat, branchChoice: BranchChoice, inputContext: AiMoveContext, difficulty = getSeatDifficulty(seat)) {
  const context = resolveAiMoveContext(inputContext);
  const projection = projectAiMove(piece, result, seat, branchChoice, context);
  if (!projection) return Number.NEGATIVE_INFINITY;
  if (difficulty === 'hard') return scoreHardProjection(piece, projection, context);
  const profile = AI_SCORE_PROFILES.easy;
  const startsNewPiece = !piece.started && result.steps > 0;
  return (projection.finishedPieceCount ? profile.finish : 0)
    + (projection.capturedPieceCount ? profile.capture : 0)
    + (projection.usesShortcut ? profile.shortcut : 0)
    + (startsNewPiece ? profile.start : 0)
    + (projection.mergedPieceCount * profile.stack)
    - projection.remainingDistance;
}

function getBranchChoices(piece: BoardPiece, result: YutResult): BranchChoice[] {
  if (result.steps <= 0 || !piece.started || !BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number])) return ['outer'];
  return ['outer', 'shortcut'];
}

function compareAiMoveCandidates(left: AiMoveCandidate, right: AiMoveCandidate) {
  return right.score - left.score
    || (right.projection?.finishedPieceCount ?? 0) - (left.projection?.finishedPieceCount ?? 0)
    || (right.projection?.capturedPieceCount ?? 0) - (left.projection?.capturedPieceCount ?? 0)
    || ((right.projection?.threatBefore ?? 0) - (right.projection?.threatAfter ?? 0)) - ((left.projection?.threatBefore ?? 0) - (left.projection?.threatAfter ?? 0))
    || (left.projection?.remainingDistance ?? 99) - (right.projection?.remainingDistance ?? 99)
    || left.branchChoice.localeCompare(right.branchChoice)
    || left.piece.id.localeCompare(right.piece.id);
}

function getAiMoveCandidatesForDifficulty(seat: Seat, result: YutResult, inputContext: AiMoveContext, difficulty: AiDifficulty) {
  const context = resolveAiMoveContext(inputContext);
  return context.pieces
    .filter((piece) => context.canSeatControlPiece(seat, piece) && !piece.finished && (result.steps >= 0 || piece.started))
    .flatMap((piece) => getBranchChoices(piece, result).map((branchChoice) => {
      const projection = projectAiMove(piece, result, seat, branchChoice, context);
      return { piece, branchChoice, projection: projection ?? undefined, score: scoreAiMove(piece, result, seat, branchChoice, context, difficulty) };
    }))
    .sort(compareAiMoveCandidates);
}

export function getAiMoveCandidates(seat: Seat, result: YutResult, context: AiMoveContext) {
  return getAiMoveCandidatesForDifficulty(seat, result, context, getSeatDifficulty(seat));
}

export function chooseAiMoveCandidate(candidates: AiMoveCandidate[], difficulty: AiDifficulty, random = Math.random) {
  return chooseScoredAiCandidate(candidates, difficulty, random);
}

function clonePiece(piece: BoardPiece): BoardPiece {
  return { ...piece };
}

function applyCandidateToPlannerState(seat: Seat, action: AiStackedPlanAction, state: PlannerState): PlannerState {
  const context = state.context;
  const movingGroup = getControlledGroup(action.piece, seat, context);
  const movingGroupIds = new Set(movingGroup.map((piece) => piece.id));
  const fromNodeId = action.piece.nodeId;
  const landedNodeId = action.projection?.landedNodeId ?? fromNodeId;
  const finished = landedNodeId === FINISH_NODE_ID;
  let pieces = context.pieces.map(clonePiece).map((piece) => movingGroupIds.has(piece.id) ? {
    ...piece,
    nodeId: landedNodeId,
    nodeIndex: piece.nodeIndex,
    started: !finished,
    finished,
    previousNodeId: finished ? undefined : fromNodeId,
  } : piece);
  let trapNodeIds = [...context.trapNodeIds];
  let shieldedPieceIds = [...context.shieldedPieceIds];
  let boardItems = [...context.boardItems];

  if (!finished && trapNodeIds.includes(landedNodeId)) {
    trapNodeIds = trapNodeIds.filter((nodeId) => nodeId !== landedNodeId);
    shieldedPieceIds = shieldedPieceIds.filter((id) => !movingGroupIds.has(id));
    pieces = pieces.map((piece) => movingGroupIds.has(piece.id) ? {
      ...piece,
      nodeId: 'n01',
      nodeIndex: 0,
      started: false,
      finished: false,
      previousNodeId: undefined,
    } : piece);
  } else if (!finished) {
    const shieldedTargets = pieces.filter((piece) => !movingGroupIds.has(piece.id)
      && piece.started
      && !piece.finished
      && piece.nodeId === landedNodeId
      && !context.isSameSide(context.getSeatById(piece.ownerId), seat)
      && shieldedPieceIds.includes(piece.id));
    shieldedPieceIds = shieldedPieceIds.filter((id) => !shieldedTargets.some((piece) => piece.id === id));
    const capturedIds = new Set(pieces.filter((piece) => !movingGroupIds.has(piece.id)
      && piece.started
      && !piece.finished
      && piece.nodeId === landedNodeId
      && !context.isSameSide(context.getSeatById(piece.ownerId), seat)
      && !shieldedTargets.some((target) => target.id === piece.id)).map((piece) => piece.id));
    pieces = pieces.map((piece) => capturedIds.has(piece.id) ? {
      ...piece,
      nodeId: 'n01',
      nodeIndex: 0,
      started: false,
      finished: false,
      previousNodeId: undefined,
    } : piece);
    boardItems = boardItems.filter((item) => item.nodeId !== landedNodeId);
  }

  return {
    context: {
      ...context,
      pieces,
      trapNodeIds,
      shieldedPieceIds,
      boardItems,
    },
  };
}

function makePlannerState(context: AiMoveContext): PlannerState {
  return { context: resolveAiMoveContext(context) };
}

function makePlannerMemoKey(state: PlannerState, remainingIndexes: number[], depth: number) {
  const pieceKey = state.context.pieces.map((piece) => `${piece.id}:${piece.nodeId}:${piece.started ? 1 : 0}:${piece.finished ? 1 : 0}:${piece.previousNodeId ?? ''}`).sort().join('|');
  return `${depth};${remainingIndexes.join(',')};${pieceKey};s:${state.context.shieldedPieceIds.slice().sort().join(',')};t:${state.context.trapNodeIds.slice().sort().join(',')}`;
}

export function planAiStackedMove(
  seat: Seat,
  rollStack: YutResult[],
  inputContext: AiMoveContext,
  options: { maxDepth?: number; beamWidth?: number; nodeLimit?: number } = {},
): AiStackedMovePlan | undefined {
  if (!rollStack.length) return undefined;
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? DEFAULT_PLANNER_DEPTH, rollStack.length));
  const beamWidth = Math.max(1, options.beamWidth ?? DEFAULT_PLANNER_BEAM_WIDTH);
  const nodeLimit = Math.max(1, options.nodeLimit ?? DEFAULT_PLANNER_NODE_LIMIT);
  const budget = { explored: 0, limited: false };
  const memo = new Map<string, PlannerSearchResult>();
  const indexedRolls = rollStack.map((roll, index) => ({ roll, index }));

  const search = (state: PlannerState, remaining: typeof indexedRolls, depth: number): PlannerSearchResult => {
    if (!remaining.length || depth >= maxDepth || budget.explored >= nodeLimit) {
      if (budget.explored >= nodeLimit && remaining.length) budget.limited = true;
      return { actions: [], score: 0 };
    }
    const memoKey = makePlannerMemoKey(state, remaining.map((entry) => entry.index), depth);
    const memoized = memo.get(memoKey);
    if (memoized) return memoized;

    const choices = remaining.flatMap((entry) => {
      const candidates = getAiMoveCandidatesForDifficulty(seat, entry.roll, state.context, 'hard');
      if (!candidates.length && entry.roll.steps < 0) {
        return [{ entry, action: null as AiMoveCandidate | null, immediateScore: -25 }];
      }
      return candidates.slice(0, beamWidth).map((action) => ({ entry, action, immediateScore: action.score }));
    }).sort((left, right) => right.immediateScore - left.immediateScore
      || left.entry.index - right.entry.index
      || (left.action?.piece.id ?? '').localeCompare(right.action?.piece.id ?? ''))
      .slice(0, beamWidth);

    let best: PlannerSearchResult = { actions: [], score: Number.NEGATIVE_INFINITY };
    for (const choice of choices) {
      if (budget.explored >= nodeLimit) { budget.limited = true; break; }
      budget.explored += 1;
      const nextRemaining = remaining.filter((entry) => entry.index !== choice.entry.index);
      if (!choice.action) {
        const future = search(state, nextRemaining, depth + 1);
        const score = choice.immediateScore + future.score * FUTURE_SCORE_DISCOUNT;
        if (score > best.score) best = { actions: future.actions, score };
        continue;
      }
      const plannedAction: AiStackedPlanAction = { ...choice.action, roll: choice.entry.roll, rollStackIndex: choice.entry.index };
      const nextState = applyCandidateToPlannerState(seat, plannedAction, state);
      const future = search(nextState, nextRemaining, depth + 1);
      const score = choice.immediateScore + future.score * FUTURE_SCORE_DISCOUNT;
      const candidateResult = { actions: [plannedAction, ...future.actions], score };
      const currentFirst = best.actions[0];
      const candidateFirst = candidateResult.actions[0];
      const shouldReplace = score > best.score
        || (score === best.score && candidateFirst && currentFirst && (
          (candidateFirst.projection?.finishedPieceCount ?? 0) > (currentFirst.projection?.finishedPieceCount ?? 0)
          || ((candidateFirst.projection?.finishedPieceCount ?? 0) === (currentFirst.projection?.finishedPieceCount ?? 0)
            && (candidateFirst.projection?.capturedPieceCount ?? 0) > (currentFirst.projection?.capturedPieceCount ?? 0))
          || ((candidateFirst.projection?.capturedPieceCount ?? 0) === (currentFirst.projection?.capturedPieceCount ?? 0)
            && candidateFirst.rollStackIndex < currentFirst.rollStackIndex)
          || (candidateFirst.rollStackIndex === currentFirst.rollStackIndex && candidateFirst.piece.id.localeCompare(currentFirst.piece.id) < 0)
        ));
      if (shouldReplace || !best.actions.length) best = candidateResult;
    }
    if (!Number.isFinite(best.score)) best = { actions: [], score: 0 };
    memo.set(memoKey, best);
    return best;
  };

  const result = search(makePlannerState(inputContext), indexedRolls, 0);
  const action = result.actions[0];
  if (!action) return undefined;
  return { action, actions: result.actions, totalScore: result.score, exploredNodes: budget.explored, limited: budget.limited };
}

function planStartingWithIndex(seat: Seat, rollStack: YutResult[], firstIndex: number, context: AiMoveContext) {
  const firstRoll = rollStack[firstIndex];
  if (!firstRoll) return undefined;
  const firstCandidates = getAiMoveCandidatesForDifficulty(seat, firstRoll, context, 'hard');
  const remaining = rollStack.filter((_, index) => index !== firstIndex);
  let best: AiStackedMovePlan | undefined;
  for (const candidate of firstCandidates.slice(0, DEFAULT_PLANNER_BEAM_WIDTH)) {
    const action: AiStackedPlanAction = { ...candidate, roll: firstRoll, rollStackIndex: firstIndex };
    const nextState = applyCandidateToPlannerState(seat, action, makePlannerState(context));
    const future = planAiStackedMove(seat, remaining, nextState.context, {
      maxDepth: Math.max(1, DEFAULT_PLANNER_DEPTH - 1),
      beamWidth: DEFAULT_PLANNER_BEAM_WIDTH,
      nodeLimit: DEFAULT_PLANNER_NODE_LIMIT,
    });
    const totalScore = candidate.score + (future?.totalScore ?? 0) * FUTURE_SCORE_DISCOUNT;
    const actions = [action, ...(future?.actions ?? []).map((futureAction) => ({
      ...futureAction,
      rollStackIndex: futureAction.rollStackIndex >= firstIndex ? futureAction.rollStackIndex + 1 : futureAction.rollStackIndex,
    }))];
    const plan = { action, actions, totalScore, exploredNodes: 1 + (future?.exploredNodes ?? 0), limited: future?.limited ?? false };
    if (!best || totalScore > best.totalScore || (totalScore === best.totalScore && compareAiMoveCandidates(action, best.action) < 0)) best = plan;
  }
  return best;
}

type HardBatchEntry = { roll: YutResult; output: AiMoveCandidate };
type HardBatch = { key: string; seat: Seat; context: AiMoveContext; entries: HardBatchEntry[] };
const pieceArrayIdentity = new WeakMap<object, number>();
let nextPieceArrayIdentity = 1;
let hardBatch: HardBatch | null = null;

function getBatchKey(seat: Seat, context: AiMoveContext) {
  const piecesObject = context.pieces as unknown as object;
  let identity = pieceArrayIdentity.get(piecesObject);
  if (!identity) {
    identity = nextPieceArrayIdentity;
    nextPieceArrayIdentity += 1;
    pieceArrayIdentity.set(piecesObject, identity);
  }
  return `${seat.id}:${identity}`;
}

function rerankHardBatch(batch: HardBatch) {
  const rolls = batch.entries.map((entry) => entry.roll);
  batch.entries.forEach((entry, index) => {
    const plan = planStartingWithIndex(batch.seat, rolls, index, batch.context);
    if (!plan) {
      entry.output.score = Number.NEGATIVE_INFINITY;
      return;
    }
    entry.output.piece = plan.action.piece;
    entry.output.branchChoice = plan.action.branchChoice;
    entry.output.projection = plan.action.projection;
    entry.output.score = plan.totalScore;
  });
}

function registerHardBatchMove(seat: Seat, roll: YutResult, context: AiMoveContext, candidate: AiMoveCandidate) {
  const key = getBatchKey(seat, context);
  if (!hardBatch || hardBatch.key !== key) {
    const batch: HardBatch = { key, seat, context, entries: [] };
    hardBatch = batch;
    queueMicrotask(() => { if (hardBatch === batch) hardBatch = null; });
  }
  const output = { ...candidate };
  hardBatch.entries.push({ roll, output });
  rerankHardBatch(hardBatch);
  return output;
}

export function chooseAiMove(seat: Seat, result: YutResult, inputContext: AiMoveContext, random = Math.random) {
  const difficulty = getSeatDifficulty(seat);
  const context = resolveAiMoveContext(inputContext);
  const candidate = chooseAiMoveCandidate(getAiMoveCandidatesForDifficulty(seat, result, context, difficulty), difficulty, random);
  if (!candidate || difficulty !== 'hard') return candidate;
  return registerHardBatchMove(seat, result, context, candidate);
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

if (typeof window !== 'undefined') {
  (window as typeof window & { __YUT_AI_STRATEGY__?: { planAiStackedMove: typeof planAiStackedMove } }).__YUT_AI_STRATEGY__ = { planAiStackedMove };
}
