import type { BoardItem, BoardNode } from '../../../game-core/board/board';
import { BOARD_NODES } from '../../../game-core/board/board';
import { ITEM_DEFINITIONS, type ItemType } from '../../items/logic/items';

export type BoardPiece = {
  id: string;
  label: string;
  color: string;
  nodeIndex: number;
  finished: boolean;
};

type GameBoardProps = {
  pieces: BoardPiece[];
  items: BoardItem[];
  selectedPieceId?: string;
  onSelectPiece: (pieceId: string) => void;
  revealedItems: ItemType[];
};

function getPieceStyle(piece: BoardPiece) {
  const node: BoardNode | undefined = BOARD_NODES[piece.nodeIndex] ?? BOARD_NODES[0];
  return { left: `${node.x}%`, top: `${node.y}%`, background: piece.color };
}

export function GameBoard({ pieces, items, selectedPieceId, onSelectPiece, revealedItems }: GameBoardProps) {
  return <div className="board" aria-label="윷놀이 말판">
    {BOARD_NODES.map((node) => {
      const item = items.find((boardItem) => boardItem.nodeId === node.id);
      const itemName = item ? ITEM_DEFINITIONS[item.type].name : '';
      return <div key={node.id} className={`board-node ${node.kind}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} title={node.id}>
        {item ? <span className="floating-board-item" aria-label="말판 아이템">
          <span className="item-orb" aria-hidden="true">?</span>
          {revealedItems.includes(item.type) ? <span className="item-revealed-name">{itemName}</span> : null}
        </span> : null}
      </div>;
    })}
    {pieces.map((piece) => <button
      type="button"
      key={piece.id}
      className={`piece-token ${selectedPieceId === piece.id ? 'selected' : ''} ${piece.finished ? 'finished' : ''}`}
      style={getPieceStyle(piece)}
      onClick={() => onSelectPiece(piece.id)}
      disabled={piece.finished}
      aria-label={`${piece.label} 말 선택`}
    >{piece.finished ? '완' : piece.label}</button>)}
  </div>;
}
