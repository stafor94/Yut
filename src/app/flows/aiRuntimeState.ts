import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { BoardItem } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';

type RuntimeTrapNode = { nodeId?: string } | string;

export type AiRuntimeState = {
  rollStack: readonly YutResult[];
  boardItems: readonly BoardItem[];
  trapNodeIds: readonly string[];
  shieldedPieceIds: readonly string[];
};

const runtimeStateByPieces = new WeakMap<BoardPiece[], AiRuntimeState>();

export function registerAiRuntimeState(
  pieces: BoardPiece[] | undefined,
  state: {
    rollStack?: readonly YutResult[];
    boardItems?: readonly BoardItem[];
    trapNodes?: readonly RuntimeTrapNode[];
    shieldedPieceIds?: readonly string[];
  },
) {
  if (!Array.isArray(pieces)) return;
  runtimeStateByPieces.set(pieces, {
    rollStack: Array.isArray(state.rollStack) ? state.rollStack : [],
    boardItems: Array.isArray(state.boardItems) ? state.boardItems : [],
    trapNodeIds: Array.isArray(state.trapNodes)
      ? state.trapNodes.map((entry) => typeof entry === 'string' ? entry : entry?.nodeId ?? '').filter(Boolean)
      : [],
    shieldedPieceIds: Array.isArray(state.shieldedPieceIds) ? state.shieldedPieceIds : [],
  });
}

export function getAiRuntimeState(pieces: BoardPiece[]) {
  return runtimeStateByPieces.get(pieces);
}
