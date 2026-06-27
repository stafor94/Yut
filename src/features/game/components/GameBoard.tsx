import type { BoardItem, BoardNode } from '../../../game-core/board/board';
import { BOARD_NODES } from '../../../game-core/board/board';
import { ITEM_DEFINITIONS, type ItemType } from '../../items/logic/items';

export type BoardPiece = {
  id: string;
  label: string;
  ownerId: string;
  color: string;
  nodeIndex: number;
  started: boolean;
  finished: boolean;
};

type GameBoardProps = {
  pieces: BoardPiece[];
  items: BoardItem[];
  selectedPieceId?: string;
  movingPieceId?: string;
  onSelectPiece: (pieceId: string) => void;
  revealedItems: ItemType[];
  highlightedNodeId?: string;
};

function getPieceStyle(piece: BoardPiece, pieces: BoardPiece[]) {
  if (!piece.started && !piece.finished) {
    const ownerPieces = pieces.filter((candidate) => candidate.ownerId === piece.ownerId && !candidate.started && !candidate.finished);
    const ownerIndex = Math.max(0, ownerPieces.findIndex((candidate) => candidate.id === piece.id));
    const ownerOrder = Array.from(new Set(pieces.map((candidate) => candidate.ownerId))).findIndex((ownerId) => ownerId === piece.ownerId);
    return { left: `${112 + ownerIndex * 8}%`, top: `${20 + Math.max(0, ownerOrder) * 15}%`, background: piece.color, translate: '-50% -50%' };
  }
  const node: BoardNode | undefined = BOARD_NODES[piece.nodeIndex] ?? BOARD_NODES[0];
  const stackedPieces = pieces.filter((candidate) => candidate.nodeIndex === piece.nodeIndex && candidate.finished === piece.finished);
  const stackIndex = Math.max(0, stackedPieces.findIndex((candidate) => candidate.id === piece.id));
  const angle = (Math.PI * 2 * stackIndex) / Math.max(stackedPieces.length, 1);
  const radius = stackedPieces.length > 1 ? 12 : 0;
  const xOffset = Number((Math.cos(angle) * radius).toFixed(1));
  const yOffset = Number((Math.sin(angle) * radius).toFixed(1));
  return { left: `${node.x}%`, top: `${node.y}%`, background: piece.color, translate: `calc(-50% + ${xOffset}px) calc(-50% + ${yOffset}px)` };
}

export function GameBoard({ pieces, items, selectedPieceId, movingPieceId, onSelectPiece, highlightedNodeId }: GameBoardProps) {
  return <div className="board" aria-label="윷놀이 말판">
    <svg className="board-route-lines" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="84" height="84" rx="0" />
      <line x1="8" y1="8" x2="92" y2="92" />
      <line x1="92" y1="8" x2="8" y2="92" />
    </svg>
    {BOARD_NODES.map((node) => {
      const item = items.find((boardItem) => boardItem.nodeId === node.id);
      return <div key={node.id} className={`board-node ${node.kind} ${highlightedNodeId === node.id ? 'item-collected' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} title={node.id}>
        {item ? <span className="floating-board-item" aria-label="말판 아이템">
          <span className="item-orb" aria-hidden="true">{ITEM_DEFINITIONS[item.type].icon}</span>
        </span> : null}
      </div>;
    })}
    {pieces.map((piece) => <button
      type="button"
      key={piece.id}
      className={`piece-token ${selectedPieceId === piece.id ? 'selected' : ''} ${movingPieceId === piece.id ? 'moving' : ''} ${piece.finished ? 'finished' : ''}`}
      style={getPieceStyle(piece, pieces)}
      onClick={() => onSelectPiece(piece.id)}
      disabled={piece.finished}
      aria-label={`${piece.label} 말 선택`}
    >{piece.finished ? '완' : piece.label}</button>)}
  </div>;
}
