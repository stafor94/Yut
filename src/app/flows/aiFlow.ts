import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import { BOARD_NODES, BRANCH_NODE_IDS, getMovePathNodeIds, type BranchChoice } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import { GOLDEN_YUT_CHOICES } from '../../game-core/roll';
import type { Seat } from '../appState';
import { getEffectiveBranchChoice } from '../appUtils';

export const getAiBranchChoice = (piece: BoardPiece): BranchChoice => piece.started && BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? 'shortcut' : 'outer';

type AiMoveContext = {
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  getSeatById: (seatId: string) => Seat | undefined;
  isSameSide: (left: Seat | undefined, right: Seat | undefined) => boolean;
  pieces: BoardPiece[];
};

export function scoreAiMove(piece: BoardPiece, result: YutResult, seat: Seat, aiBranchChoice: BranchChoice, { canSeatControlPiece, getSeatById, isSameSide, pieces }: AiMoveContext) {
  const steps = result.steps;
  if (steps < 0 && !piece.started) return Number.NEGATIVE_INFINITY;
  const pathNodeIds = getMovePathNodeIds(piece.nodeId, steps, getEffectiveBranchChoice(piece.nodeId, aiBranchChoice));
  const landedNodeId = pathNodeIds[pathNodeIds.length - 1] ?? piece.nodeId;
  const finishes = steps > 0 && piece.started && pathNodeIds.slice(0, steps - 1).includes('n01');
  const captures = !finishes && pieces.some((target) => !isSameSide(getSeatById(target.ownerId), seat) && target.started && !target.finished && target.nodeId === landedNodeId);
  const stacks = !finishes && piece.started ? pieces.filter((target) => canSeatControlPiece(seat, target) && target.started && !target.finished && target.nodeId === piece.nodeId).length - 1 : 0;
  const startsNewPiece = !piece.started && steps > 0;
  const progress = finishes ? 25 : BOARD_NODES.findIndex((node) => node.id === landedNodeId);
  return (finishes ? 1000 : 0) + (captures ? 400 : 0) + (aiBranchChoice === 'shortcut' ? 80 : 0) + (startsNewPiece ? 60 : 0) + (stacks * 30) + progress - (piece.finished ? 10000 : 0);
}

export function chooseAiMove(seat: Seat, result: YutResult, context: AiMoveContext) {
  return context.pieces
    .filter((piece) => context.canSeatControlPiece(seat, piece) && !piece.finished && (result.steps >= 0 || piece.started))
    .map((piece) => {
      const aiBranchChoice = getAiBranchChoice(piece);
      return { piece, branchChoice: aiBranchChoice, score: scoreAiMove(piece, result, seat, aiBranchChoice, context) };
    })
    .sort((left, right) => right.score - left.score)[0];
}

export function getAiItemValue(type: ItemType) {
  if (type === 'golden_yut') return 90;
  if (type === 'reroll') return 75;
  if (type === 'move_plus_one') return 70;
  if (type === 'trap') return 62;
  if (type === 'shield') return 58;
  if (type === 'move_minus_one') return 45;
  return 0;
}

export function shouldAiUseReroll(seat: Seat, result: YutResult, context: AiMoveContext) {
  const move = chooseAiMove(seat, result, context);
  if (!move) return true;
  return result.steps <= 1 && move.score < 120;
}

export function chooseAiGoldenYutResult(seat: Seat, context: AiMoveContext) {
  return [...GOLDEN_YUT_CHOICES]
    .map((choice) => ({ choice, move: chooseAiMove(seat, choice, context) }))
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
