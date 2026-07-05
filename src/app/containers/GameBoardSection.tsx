import { GameBoard, type BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import type { BoardItem, BranchChoice } from '../../game-core/board/board';
import type { CaptureEffect, FallEffect, Seat, TrapEffect, TrapNode } from '../appState';

type GameBoardSectionProps = {
  pieces: BoardPiece[];
  boardItems: BoardItem[];
  selectedPieceId: string;
  activeMovablePiece?: BoardPiece;
  selectedGroupPieceIds: string[];
  movingPieceId: string;
  isMyTurn: boolean;
  activeSeat?: Seat;
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  onSelectPieceId: (pieceId: string) => void;
  getPieceSideKey: (piece: BoardPiece) => string;
  revealedItems: ItemType[];
  highlightedNodeId: string;
  trapNodes: TrapNode[];
  previewNodeIds: string[];
  branchChoice: BranchChoice;
  onBranchChoiceChange: (choice: BranchChoice) => void;
  captureEffect: CaptureEffect | null;
  trapEffect: TrapEffect | null;
  fallEffect: FallEffect | null;
  trapPlacementNodeIds: string[];
  onSelectTrapNode: (nodeId: string) => void;
};

export function GameBoardSection({
  pieces,
  boardItems,
  selectedPieceId,
  activeMovablePiece,
  selectedGroupPieceIds,
  movingPieceId,
  isMyTurn,
  activeSeat,
  canSeatControlPiece,
  onSelectPieceId,
  getPieceSideKey,
  revealedItems,
  highlightedNodeId,
  trapNodes,
  previewNodeIds,
  branchChoice,
  onBranchChoiceChange,
  captureEffect,
  trapEffect,
  fallEffect,
  trapPlacementNodeIds,
  onSelectTrapNode,
}: GameBoardSectionProps) {
  const selectedPieceIds = selectedGroupPieceIds.length ? selectedGroupPieceIds : activeMovablePiece ? [activeMovablePiece.id] : [];
  const capturedPieceIds = Array.from(new Set([...(captureEffect?.pieceIds ?? []), ...(trapEffect?.pieceIds ?? [])]));
  const trapNodeIds = trapNodes.map((trap) => trap.nodeId);

  return <GameBoard
    pieces={pieces}
    items={boardItems}
    selectedPieceId={selectedPieceId || activeMovablePiece?.id}
    selectedPieceIds={selectedPieceIds}
    movingPieceId={movingPieceId}
    onSelectPiece={(pieceId) => {
      const targetPiece = pieces.find((piece) => piece.id === pieceId);
      if (!targetPiece || !isMyTurn || !activeSeat || !canSeatControlPiece(activeSeat, targetPiece)) return;
      onSelectPieceId(pieceId);
    }}
    getPieceGroupKey={getPieceSideKey}
    revealedItems={revealedItems}
    highlightedNodeId={highlightedNodeId}
    trapNodeIds={trapNodeIds}
    previewNodeIds={previewNodeIds}
    branchChoice={branchChoice}
    onBranchChoiceChange={onBranchChoiceChange}
    showBranchControls={false}
    capturedPieceIds={capturedPieceIds}
    trapEffectNodeId={trapEffect?.nodeId}
    selectableNodeIds={trapPlacementNodeIds}
    onSelectNode={onSelectTrapNode}
    boardShaking={Boolean(captureEffect)}
    showFallEffect={Boolean(fallEffect)}
    isPieceSelectable={(piece) => Boolean(isMyTurn && activeSeat && canSeatControlPiece(activeSeat, piece))}
  />;
}
