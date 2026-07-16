import type { BoardPiece } from '../../features/game/components/GameBoard';
import { getAiItemValue, type ItemType } from '../../features/items/logic/items';
import { BOARD_NODES, BRANCH_NODE_IDS, getMovePathNodeIds, type BranchChoice } from '../../game-core/board/board';
import { getCurrentAiRollDifficulty, getEffectiveAiDifficulty, type AiDifficulty } from '../../game-core/aiDifficulty';
import type { YutResult } from '../../game-core/roll';
import { GOLDEN_YUT_CHOICES } from '../../game-core/roll';
import type { Seat } from '../appState';
import { getEffectiveBranchChoice } from '../appUtils';

export { getAiItemValue };

export const getAiBranchChoice = (piece: BoardPiece): BranchChoice => piece.started && BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? 'shortcut' : 'outer';

type AiMoveContext = {
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  getSeatById: (seatId: string) => Seat | undefined;
  isSameSide: (left: Seat | undefined, right: Seat | undefined) => boolean;
  pieces: BoardPiece[];
};

type AiScoreProfile = {
  finish: number;
  capture: number;
  shortcut: number;
  start: number;
  stack: number;
  candidateRange: number;
};

export type AiMoveCandidate = {
  piece: BoardPiece;
  branchChoice: BranchChoice;
  score: number;
};

const AI_SCORE_PROFILES: Record<AiDifficulty, AiScoreProfile> = {
  hard: { finish: 180, capture: 90, shortcut: 55, start: 35, stack: 12, candidateRange: 20 },
  easy: { finish: 110, capture: 55, shortcut: 35, start: 25, stack: 8, candidateRange: 45 },
};

const getSeatDifficulty = (seat: Seat): AiDifficulty => {
  const source = seat as Seat & { aiDifficulty?: unknown };
  if (source.isSubstitutedByAI) return 'hard';
  if (source.aiDifficulty === 'easy') return 'easy';
  return getCurrentAiRollDifficulty();
};

export function scoreAiMove(piece: BoardPiece, result: YutResult, seat: Seat, aiBranchChoice: BranchChoice, { canSeatControlPiece, getSeatById, isSameSide, pieces }: AiMoveContext, difficulty = getSeatDifficulty(seat)) {
  const steps = result.steps;
  if (steps < 0 && !piece.started) return Number.NEGATIVE_INFINITY;
  const pathNodeIds = getMovePathNodeIds(piece.nodeId, steps, getEffectiveBranchChoice(piece.nodeId, aiBranchChoice));
  const landedNodeId = pathNodeIds[pathNodeIds.length - 1] ?? piece.nodeId;
  const finishes = steps > 0 && piece.started && pathNodeIds.slice(0, steps - 1).includes('n01');
  const captures = !finishes && pieces.some((target) => !isSameSide(getSeatById(target.ownerId), seat) && target.started && !target.finished && target.nodeId === landedNodeId);
  const stacks = !finishes && piece.started ? pieces.filter((target) => canSeatControlPiece(seat, target) && target.started && !target.finished && target.nodeId === piece.nodeId).length - 1 : 0;
  const startsNewPiece = !piece.started && steps > 0;
  const progress = finishes ? 25 : BOARD_NODES.findIndex((node) => node.id === landedNodeId);
  const profile = AI_SCORE_PROFILES[difficulty];
  return (finishes ? profile.finish : 0) + (captures ? profile.capture : 0) + (aiBranchChoice === 'shortcut' ? profile.shortcut : 0) + (startsNewPiece ? profile.start : 0) + (stacks * profile.stack) + progress - (piece.finished ? 10000 : 0);
}

export function getAiMoveCandidates(seat: Seat, result: YutResult, context: AiMoveContext) {
  const difficulty = getSeatDifficulty(seat);
  return context.pieces
    .filter((piece) => context.canSeatControlPiece(seat, piece) && !piece.finished && (result.steps >= 0 || piece.started))
    .map((piece) => {
      const aiBranchChoice = getAiBranchChoice(piece);
      return { piece, branchChoice: aiBranchChoice, score: scoreAiMove(piece, result, seat, aiBranchChoice, context, difficulty) };
    })
    .sort((left, right) => right.score - left.score);
}

const getCandidateWeight = (difficulty: AiDifficulty, scoreGap: number) => {
  if (difficulty === 'hard') {
    if (scoreGap <= 0) return 70;
    if (scoreGap <= 10) return 22;
    return 8;
  }
  if (scoreGap <= 0) return 45;
  if (scoreGap <= 15) return 30;
  if (scoreGap <= 30) return 15;
  return 10;
};

export function chooseAiMoveCandidate(candidates: AiMoveCandidate[], difficulty: AiDifficulty, random = Math.random) {
  if (!candidates.length) return undefined;
  if (candidates.length === 1) return candidates[0];

  if (difficulty === 'easy' && random() < 0.1) {
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  }

  const bestScore = candidates[0].score;
  const eligible = candidates.filter((candidate) => bestScore - candidate.score <= AI_SCORE_PROFILES[difficulty].candidateRange);
  const weighted = eligible.map((candidate) => ({ candidate, weight: getCandidateWeight(difficulty, bestScore - candidate.score) }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * totalWeight;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.candidate;
  }
  return weighted[weighted.length - 1]?.candidate ?? candidates[0];
}

export function chooseAiMove(seat: Seat, result: YutResult, context: AiMoveContext, random = Math.random) {
  return chooseAiMoveCandidate(getAiMoveCandidates(seat, result, context), getSeatDifficulty(seat), random);
}

export function shouldAiUseReroll(seat: Seat, result: YutResult, context: AiMoveContext) {
  const move = getAiMoveCandidates(seat, result, context)[0];
  if (!move) return true;
  const threshold = getSeatDifficulty(seat) === 'easy' ? 35 : 55;
  return result.steps <= 1 && move.score < threshold;
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
