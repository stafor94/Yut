import type { CSSProperties } from 'react';
import type { CaptureVisualEffect } from '../../../app/flows/captureAnimation';
import type { BoardItem, BoardNode, BranchChoice } from '../../../game-core/board/board';
import { BOARD_NODES, FINISH_NODE_ID } from '../../../game-core/board/board';
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
  previousNodeId?: string;
};

type GameBoardProps = {
  pieces: BoardPiece[];
  items: BoardItem[];
  selectedPieceId?: string;
  selectedPieceIds?: string[];
  movingPieceId?: string;
  onSelectPiece: (pieceId: string) => void;
  revealedItems: ItemType[];
  highlightedNodeId?: string;
  trapNodeIds?: string[];
  shieldedPieceIds?: string[];
  previewNodeIds?: string[];
  branchChoice?: BranchChoice;
  onBranchChoiceChange?: (branchChoice: BranchChoice) => void;
  showBranchControls?: boolean;
  capturedPieceIds?: string[];
  captureEffect?: CaptureVisualEffect | null;
  captureDestinationNodeId?: string;
  trapEffectNodeId?: string;
  selectableNodeIds?: string[];
  onSelectNode?: (nodeId: string) => void;
  boardShaking?: boolean;
  isPieceSelectable?: (piece: BoardPiece) => boolean;
  showFallEffect?: boolean;
  getPieceGroupKey?: (piece: BoardPiece) => string;
};

function getOffBoardPieceStyle(piece: BoardPiece, ownerIndex: number, ownerOrder: number, desktopTop: number, portraitTop: number) {
  const portraitColumn = ownerOrder % 2;
  return {
    left: `${108 + ownerIndex * 5}%`,
    top: `${desktopTop}%`,
    background: piece.color,
    translate: '-50% -50%',
    '--portrait-bench-left': `${16 + portraitColumn * 48 + ownerIndex * 8}%`,
    '--portrait-bench-top': `${portraitTop}px`,
  } as CSSProperties;
}

function getFinishedPieceStyle(piece: BoardPiece, pieces: BoardPiece[], getPieceGroupKey: (piece: BoardPiece) => string) {
  const pieceGroupKey = getPieceGroupKey(piece);
  const ownerOrder = Array.from(new Set(pieces.map((candidate) => getPieceGroupKey(candidate)))).findIndex((ownerId) => ownerId === pieceGroupKey);
  const safeOwnerOrder = Math.max(0, ownerOrder);
  const ownerHomePieces = pieces.filter((candidate) => getPieceGroupKey(candidate) === pieceGroupKey && !candidate.started && !candidate.finished);
  const ownerFinishedPieces = pieces.filter((candidate) => getPieceGroupKey(candidate) === pieceGroupKey && candidate.finished);
  const ownerFinishedIndex = Math.max(0, ownerFinishedPieces.findIndex((candidate) => candidate.id === piece.id));
  const benchIndex = ownerHomePieces.length + ownerFinishedIndex;
  const portraitColumn = safeOwnerOrder % 2;
  const portraitRow = Math.floor(safeOwnerOrder / 2);

  return {
    left: `${108 + benchIndex * 5}%`,
    top: `${20 + safeOwnerOrder * 15}%`,
    background: piece.color,
    translate: '-50% -50%',
    '--portrait-bench-left': `${16 + portraitColumn * 48 + benchIndex * 8}%`,
    '--portrait-bench-top': `${34 + portraitRow * 54}px`,
  } as CSSProperties;
}

function getPieceStyle(piece: BoardPiece, pieces: BoardPiece[], movingPieceId = '', getPieceGroupKey: (piece: BoardPiece) => string = (candidate) => candidate.ownerId) {
  if (!piece.started && !piece.finished && movingPieceId !== piece.id) {
    const pieceGroupKey = getPieceGroupKey(piece);
    const ownerPieces = pieces.filter((candidate) => getPieceGroupKey(candidate) === pieceGroupKey && !candidate.started && !candidate.finished);
    const ownerIndex = Math.max(0, ownerPieces.findIndex((candidate) => candidate.id === piece.id));
    const ownerOrder = Array.from(new Set(pieces.map((candidate) => getPieceGroupKey(candidate)))).findIndex((ownerId) => ownerId === pieceGroupKey);
    const safeOwnerOrder = Math.max(0, ownerOrder);
    const portraitRow = Math.floor(safeOwnerOrder / 2);
    return getOffBoardPieceStyle(piece, ownerIndex, safeOwnerOrder, 20 + safeOwnerOrder * 15, 34 + portraitRow * 54);
  }
  if (piece.finished) {
    return getFinishedPieceStyle(piece, pieces, getPieceGroupKey);
  }
  const node: BoardNode | undefined = BOARD_NODES.find((candidate) => candidate.id === piece.nodeId) ?? BOARD_NODES[piece.nodeIndex] ?? BOARD_NODES[0];
  const stackedPieces = pieces.filter((candidate) => candidate.nodeId === piece.nodeId && !candidate.finished && (candidate.started || candidate.id === movingPieceId));
  const stackIndex = Math.max(0, stackedPieces.findIndex((candidate) => candidate.id === piece.id));
  const angle = (Math.PI * 2 * stackIndex) / Math.max(stackedPieces.length, 1);
  const radius = stackedPieces.length > 1 ? 12 : 0;
  const xOffset = Number((Math.cos(angle) * radius).toFixed(1));
  const yOffset = Number((Math.sin(angle) * radius).toFixed(1));
  return { left: `${node.x}%`, top: `${node.y}%`, background: piece.color, translate: `calc(-50% + ${xOffset}px) calc(-50% + ${yOffset}px)` };
}

export function GameBoard({ pieces, items, selectedPieceId, selectedPieceIds, movingPieceId, onSelectPiece, highlightedNodeId, trapNodeIds = [], shieldedPieceIds = [], previewNodeIds = [], branchChoice = 'outer', onBranchChoiceChange, showBranchControls = false, capturedPieceIds = [], captureEffect = null, captureDestinationNodeId = '', trapEffectNodeId = '', selectableNodeIds = [], onSelectNode, boardShaking = false, isPieceSelectable, showFallEffect = false, getPieceGroupKey = (piece) => piece.ownerId }: GameBoardProps) {
  void branchChoice;
  void onBranchChoiceChange;
  void showBranchControls;
  void showFallEffect;

  const selectedIds = selectedPieceIds ?? (selectedPieceId ? [selectedPieceId] : []);
  const previewFinishes = previewNodeIds.includes(FINISH_NODE_ID);
  const visualCapturePieceIds = new Set(captureEffect?.pieceIds ?? []);
  const movingAnchor = movingPieceId ? pieces.find((piece) => piece.id === movingPieceId) : undefined;
  const movingSideKey = movingAnchor ? getPieceGroupKey(movingAnchor) : '';
  const hasCapturableDestinationTarget = Boolean(
    movingAnchor
    && captureDestinationNodeId
    && movingAnchor.nodeId === captureDestinationNodeId
    && pieces.some((piece) => piece.id !== movingAnchor.id
      && piece.started
      && !piece.finished
      && piece.nodeId === movingAnchor.nodeId
      && getPieceGroupKey(piece) !== movingSideKey
      && !shieldedPieceIds.includes(piece.id)),
  );
  const captureApproachPieceIds = new Set(hasCapturableDestinationTarget
    ? pieces.filter((piece) => piece.started && !piece.finished && piece.nodeId === movingAnchor?.nodeId && getPieceGroupKey(piece) === movingSideKey).map((piece) => piece.id)
    : []);
  const captureNode = captureEffect ? BOARD_NODES.find((node) => node.id === captureEffect.nodeId) : undefined;

  return <div data-testid="game-board" className={`board ${boardShaking ? 'capture-shake' : ''}`} aria-label="윷놀이 말판">
    <svg className="board-route-lines" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="84" height="84" rx="0" />
      <line x1="8" y1="8" x2="92" y2="92" />
      <line x1="92" y1="8" x2="8" y2="92" />
    </svg>
    {BOARD_NODES.map((node) => {
      const item = items.find((boardItem) => boardItem.nodeId === node.id);
      const selectable = selectableNodeIds.includes(node.id);
      const previewIndex = previewNodeIds.indexOf(node.id);
      const isPreviewNode = previewIndex >= 0;
      const isFinishPreview = previewFinishes && node.id === 'n01';
      return <button type="button" key={node.id} data-testid={`board-node-${node.id}`} className={`board-node ${node.kind} ${highlightedNodeId === node.id ? 'item-collected' : ''} ${isPreviewNode ? 'route-preview' : ''} ${selectable ? 'trap-selectable' : ''} ${trapEffectNodeId === node.id ? 'trap-exploding' : ''}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} title={node.id} onClick={() => selectable && onSelectNode?.(node.id)} disabled={!selectable}>
        {item ? <span className="floating-board-item" aria-label="말판 아이템">
          <span className="item-orb" aria-hidden="true">{ITEM_DEFINITIONS[item.type].icon}</span>
        </span> : null}
        {isPreviewNode ? <span className={`route-preview-marker ${isFinishPreview ? 'finish' : ''}`} aria-label={isFinishPreview ? '완주 예정' : '이동 예정 칸'}>{isFinishPreview ? '완주' : previewIndex + 1}</span> : null}
        {trapNodeIds.includes(node.id) ? <span className="trap-marker" aria-label="설치된 함정">🪤</span> : null}
      </button>;
    })}
    {pieces.map((piece) => {
      const pieceSelectable = isPieceSelectable?.(piece) !== false;
      const pieceSelected = pieceSelectable && selectedIds.includes(piece.id);
      return <button
        type="button"
        data-testid={`piece-${piece.id}`}
        key={piece.id}
        className={`piece-token ${((!piece.started && movingPieceId !== piece.id) || piece.finished) ? 'off-board' : ''} ${pieceSelected ? 'selected' : ''} ${movingPieceId === piece.id ? 'moving' : ''} ${piece.finished ? 'finished' : ''} ${shieldedPieceIds.includes(piece.id) ? 'shielded' : ''} ${piece.started && !piece.finished && capturedPieceIds.includes(piece.id) ? 'captured-highlight' : ''} ${captureApproachPieceIds.has(piece.id) ? 'capture-approach' : ''} ${visualCapturePieceIds.has(piece.id) ? 'capture-source-hidden' : ''}`}
        style={getPieceStyle(piece, pieces, movingPieceId, getPieceGroupKey)}
        onClick={() => onSelectPiece(piece.id)}
        disabled={piece.finished || !pieceSelectable}
        aria-label={`${piece.label} 말 선택${shieldedPieceIds.includes(piece.id) ? ', 방패 적용됨' : ''}`}
      >
        {piece.finished ? '완' : piece.label}
        {shieldedPieceIds.includes(piece.id) && !piece.finished ? <span className="piece-shield-badge" aria-label="방패 적용됨">🛡️</span> : null}
      </button>;
    })}
    {captureNode ? <span
      className="capture-impact-wave"
      aria-hidden="true"
      style={{ left: `${captureNode.x}%`, top: `${captureNode.y}%` }}
    /> : null}
    {captureEffect?.pieces.map((piece) => <span
      key={`${captureEffect.id}:${piece.id}`}
      className="piece-token capture-ghost"
      aria-hidden="true"
      style={{
        left: `${piece.sourceLeft}%`,
        top: `${piece.sourceTop}%`,
        background: piece.color,
        translate: '-50% -50%',
        '--capture-source-left': `${piece.sourceLeft}%`,
        '--capture-source-top': `${piece.sourceTop}%`,
        '--capture-target-left': `${piece.targetLeft}%`,
        '--capture-target-top': `${piece.targetTop}%`,
        '--capture-rotation': `${piece.rotation}deg`,
        '--capture-mid-rotation': `${piece.midRotation}deg`,
      } as CSSProperties}
    >{piece.label}</span>)}
  </div>;
}
