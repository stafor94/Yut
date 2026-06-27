import type { BoardItem, BoardNode, BranchChoice } from '../../../game-core/board/board';
import { BOARD_NODES, BRANCH_NODE_IDS } from '../../../game-core/board/board';
import { ITEM_DEFINITIONS, type ItemType } from '../../items/logic/items';

export type BoardPiece = {
  id: string;
  label: string;
  ownerId: string;
  color: string;
  nodeIndex: number;
  nodeId: string;
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
  trapNodeIds?: string[];
  previewNodeIds?: string[];
  branchChoice?: BranchChoice;
  onBranchChoiceChange?: (branchChoice: BranchChoice) => void;
  showBranchControls?: boolean;
};

function getPieceStyle(piece: BoardPiece, pieces: BoardPiece[], movingPieceId = '') {
  if (!piece.started && !piece.finished && movingPieceId !== piece.id) {
    const ownerPieces = pieces.filter((candidate) => candidate.ownerId === piece.ownerId && !candidate.started && !candidate.finished);
    const ownerIndex = Math.max(0, ownerPieces.findIndex((candidate) => candidate.id === piece.id));
    const ownerOrder = Array.from(new Set(pieces.map((candidate) => candidate.ownerId))).findIndex((ownerId) => ownerId === piece.ownerId);
    return { left: `${112 + ownerIndex * 8}%`, top: `${20 + Math.max(0, ownerOrder) * 15}%`, background: piece.color, translate: '-50% -50%' };
  }
  if (piece.finished) {
    const finishedPieces = pieces.filter((candidate) => candidate.ownerId === piece.ownerId && candidate.finished);
    const finishedIndex = Math.max(0, finishedPieces.findIndex((candidate) => candidate.id === piece.id));
    const ownerOrder = Array.from(new Set(pieces.map((candidate) => candidate.ownerId))).findIndex((ownerId) => ownerId === piece.ownerId);
    return { left: `${112 + finishedIndex * 8}%`, top: `${72 + Math.max(0, ownerOrder) * 7}%`, background: piece.color, translate: '-50% -50%' };
  }
  const node: BoardNode | undefined = BOARD_NODES.find((candidate) => candidate.id === piece.nodeId) ?? BOARD_NODES[piece.nodeIndex] ?? BOARD_NODES[0];
  const stackedPieces = pieces.filter((candidate) => candidate.nodeId === piece.nodeId && !candidate.finished);
  const stackIndex = Math.max(0, stackedPieces.findIndex((candidate) => candidate.id === piece.id));
  const angle = (Math.PI * 2 * stackIndex) / Math.max(stackedPieces.length, 1);
  const radius = stackedPieces.length > 1 ? 12 : 0;
  const xOffset = Number((Math.cos(angle) * radius).toFixed(1));
  const yOffset = Number((Math.sin(angle) * radius).toFixed(1));
  return { left: `${node.x}%`, top: `${node.y}%`, background: piece.color, translate: `calc(-50% + ${xOffset}px) calc(-50% + ${yOffset}px)` };
}

export function GameBoard({ pieces, items, selectedPieceId, movingPieceId, onSelectPiece, highlightedNodeId, trapNodeIds = [], previewNodeIds = [], branchChoice = 'outer', onBranchChoiceChange, showBranchControls = false }: GameBoardProps) {
  const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId);
  const canShowBranchControls = Boolean(
    showBranchControls &&
    selectedPiece?.started &&
    !selectedPiece.finished &&
    BRANCH_NODE_IDS.includes(selectedPiece.nodeId as typeof BRANCH_NODE_IDS[number]) &&
    onBranchChoiceChange,
  );
  const selectedPieceStyle = selectedPiece ? getPieceStyle(selectedPiece, pieces, movingPieceId) : undefined;

  return <div className="board" aria-label="윷놀이 말판">
    <svg className="board-route-lines" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="84" height="84" rx="0" />
      <line x1="8" y1="8" x2="92" y2="92" />
      <line x1="92" y1="8" x2="8" y2="92" />
    </svg>
    {BOARD_NODES.map((node) => {
      const item = items.find((boardItem) => boardItem.nodeId === node.id);
      return <div key={node.id} className={`board-node ${node.kind} ${highlightedNodeId === node.id ? 'item-collected' : ''} ${previewNodeIds.includes(node.id) ? 'route-preview' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} title={node.id}>
        {item ? <span className="floating-board-item" aria-label="말판 아이템">
          <span className="item-orb" aria-hidden="true">{ITEM_DEFINITIONS[item.type].icon}</span>
        </span> : null}
        {previewNodeIds.includes(node.id) ? <span className="route-preview-marker" aria-label="이동 예정 칸">{previewNodeIds.indexOf(node.id) + 1}</span> : null}
        {trapNodeIds.includes(node.id) ? <span className="trap-marker" aria-label="설치된 함정">🪤</span> : null}
      </div>;
    })}
    {pieces.map((piece) => <button
      type="button"
      key={piece.id}
      className={`piece-token ${selectedPieceId === piece.id ? 'selected' : ''} ${movingPieceId === piece.id ? 'moving' : ''} ${piece.finished ? 'finished' : ''}`}
      style={getPieceStyle(piece, pieces, movingPieceId)}
      onClick={() => onSelectPiece(piece.id)}
      disabled={piece.finished}
      aria-label={`${piece.label} 말 선택`}
    >{piece.finished ? '완' : piece.label}</button>)}
    {canShowBranchControls && selectedPieceStyle ? <div className="branch-controls" style={selectedPieceStyle} aria-label="이동 방향 선택">
      <span className="branch-controls-title">방향 선택</span>
      <button type="button" className={branchChoice === 'outer' ? 'active' : ''} onClick={() => onBranchChoiceChange?.('outer')} aria-label="바깥길로 이동"><span>바깥길</span><small>기본 경로</small></button>
      <button type="button" className={branchChoice === 'shortcut' ? 'active' : ''} onClick={() => onBranchChoiceChange?.('shortcut')} aria-label="지름길로 이동"><span>지름길</span><small>중앙 경로</small></button>
    </div> : null}
  </div>;
}
