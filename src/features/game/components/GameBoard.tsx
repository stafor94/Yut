import type { CSSProperties } from 'react';
import { CAPTURE_IMPACT_DELAY_MS, type CaptureVisualEffect } from '../../../app/flows/captureAnimation';
import type { FinishVisualEffect } from '../../../app/flows/finishAnimation';
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
  finishEffect?: FinishVisualEffect | null;
  trapEffectNodeId?: string;
  selectableNodeIds?: string[];
  onSelectNode?: (nodeId: string) => void;
  boardShaking?: boolean;
  isPieceSelectable?: (piece: BoardPiece) => boolean;
  showFallEffect?: boolean;
  getPieceGroupKey?: (piece: BoardPiece) => string;
};

function getPieceColorStyle(piece: BoardPiece) {
  return { '--piece-color': piece.color } as CSSProperties;
}

function getOffBoardPieceStyle(piece: BoardPiece, ownerIndex: number, ownerOrder: number, desktopTop: number, portraitTop: number) {
  const portraitColumn = ownerOrder % 2;
  return {
    left: `${108 + ownerIndex * 5}%`,
    top: `${desktopTop}%`,
    ...getPieceColorStyle(piece),
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
    ...getPieceColorStyle(piece),
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
  const nodePieces = pieces.filter((candidate) => candidate.nodeId === piece.nodeId && !candidate.finished && (candidate.started || candidate.id === movingPieceId));
  const pieceGroupKey = getPieceGroupKey(piece);
  const groupKeys = Array.from(new Set(nodePieces.map((candidate) => getPieceGroupKey(candidate))));
  const groupIndex = Math.max(0, groupKeys.findIndex((groupKey) => groupKey === pieceGroupKey));
  const groupAngle = (Math.PI * 2 * groupIndex) / Math.max(groupKeys.length, 1);
  const groupRadius = groupKeys.length > 1 ? 12 : 0;
  const xOffset = Number((Math.cos(groupAngle) * groupRadius).toFixed(1));
  const yOffset = Number((Math.sin(groupAngle) * groupRadius).toFixed(1));
  const stackedPieces = nodePieces.filter((candidate) => getPieceGroupKey(candidate) === pieceGroupKey);
  const stackIndex = Math.max(0, stackedPieces.findIndex((candidate) => candidate.id === piece.id));
  const stackLift = stackIndex * 2;

  return {
    left: `${node.x}%`,
    top: `${node.y}%`,
    ...getPieceColorStyle(piece),
    '--piece-stack-z': 10 + groupIndex * 5 + stackIndex,
    translate: `calc(-50% + ${xOffset}px) calc(-50% + ${yOffset - stackLift}px)`,
    '--piece-stack-index': stackIndex,
    '--piece-stack-size': stackedPieces.length,
  } as CSSProperties;
}

function PieceFigure() {
  return <span className="piece-token-figure" aria-hidden="true">
    <span className="piece-token-head" />
    <span className="piece-token-body" />
  </span>;
}

export function GameBoard({ pieces, items, selectedPieceId, selectedPieceIds, movingPieceId, onSelectPiece, highlightedNodeId, trapNodeIds = [], shieldedPieceIds = [], previewNodeIds = [], branchChoice = 'outer', onBranchChoiceChange, showBranchControls = false, capturedPieceIds = [], captureEffect = null, captureDestinationNodeId = '', finishEffect = null, trapEffectNodeId = '', selectableNodeIds = [], onSelectNode, boardShaking = false, isPieceSelectable, showFallEffect = false, getPieceGroupKey = (piece) => piece.ownerId }: GameBoardProps) {
  void branchChoice;
  void onBranchChoiceChange;
  void showBranchControls;
  void showFallEffect;

  const selectedIds = selectedPieceIds ?? (selectedPieceId ? [selectedPieceId] : []);
  const previewFinishes = previewNodeIds.includes(FINISH_NODE_ID);
  const visualCapturePieceIds = new Set(captureEffect?.pieceIds ?? []);
  const captureAttackerPieceIds = new Set(captureEffect?.attackerPieceIds ?? []);
  const finishPieceIds = new Set(finishEffect?.pieceIds ?? []);
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
  const finishSource = finishEffect?.pieces[0];
  const lastCaptureDelayMs = captureEffect?.pieces[captureEffect.pieces.length - 1]?.delayMs ?? 0;

  return <div
    data-testid="game-board"
    className={`board ${boardShaking ? 'capture-shake' : ''}`}
    aria-label="윷놀이 말판"
    style={{ '--capture-total-duration': `${captureEffect?.durationMs ?? 720}ms` } as CSSProperties}
  >
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
      const finishVisualPiece = finishEffect?.pieces.find((candidate) => candidate.id === piece.id);
      const stackedPieceCount = (piece.started || piece.id === movingPieceId) && !piece.finished
        ? pieces.filter((candidate) => (candidate.started || candidate.id === movingPieceId) && !candidate.finished && candidate.nodeId === piece.nodeId && getPieceGroupKey(candidate) === getPieceGroupKey(piece)).length
        : 1;
      const pieceStyle = {
        ...getPieceStyle(piece, pieces, movingPieceId, getPieceGroupKey),
        ...(finishVisualPiece ? { '--finish-delay': `${finishVisualPiece.delayMs}ms` } : {}),
      } as CSSProperties;
      return <button
        type="button"
        data-testid={`piece-${piece.id}`}
        key={piece.id}
        className={`piece-token ${((!piece.started && movingPieceId !== piece.id) || piece.finished) ? 'off-board' : ''} ${stackedPieceCount > 1 ? 'stacked' : ''} ${pieceSelected ? 'selected' : ''} ${movingPieceId === piece.id ? 'moving' : ''} ${piece.finished ? 'finished' : ''} ${shieldedPieceIds.includes(piece.id) ? 'shielded' : ''} ${piece.started && !piece.finished && capturedPieceIds.includes(piece.id) ? 'captured-highlight' : ''} ${captureApproachPieceIds.has(piece.id) ? 'capture-approach' : ''} ${captureAttackerPieceIds.has(piece.id) ? 'capture-attacker-recoil' : ''} ${visualCapturePieceIds.has(piece.id) ? 'capture-source-hidden' : ''} ${finishPieceIds.has(piece.id) ? 'finish-arrival' : ''}`}
        style={pieceStyle}
        onClick={() => onSelectPiece(piece.id)}
        disabled={piece.finished || !pieceSelectable}
        aria-label={`${piece.label} 말 선택${shieldedPieceIds.includes(piece.id) ? ', 방패 적용됨' : ''}`}
      >
        <PieceFigure />
        {piece.finished ? <span className="piece-finish-mark">완</span> : null}
        {shieldedPieceIds.includes(piece.id) && !piece.finished ? <span className="piece-shield-badge" aria-label="방패 적용됨">🛡️</span> : null}
      </button>;
    })}
    {captureNode ? captureEffect?.pieces.map((piece, index) => <span
      key={`${captureEffect.id}:impact:${piece.id}`}
      className={`capture-impact-wave ${index === captureEffect.pieces.length - 1 ? 'last' : ''}`}
      aria-hidden="true"
      style={{
        left: `${captureNode.x}%`,
        top: `${captureNode.y}%`,
        '--capture-delay': `${piece.delayMs}ms`,
      } as CSSProperties}
    />) : null}
    {captureNode && (captureEffect?.pieceCount ?? 0) > 1 ? <span
      className="capture-chain-count"
      aria-hidden="true"
      style={{
        left: `${captureNode.x}%`,
        top: `${captureNode.y}%`,
        '--capture-count-delay': `${CAPTURE_IMPACT_DELAY_MS + lastCaptureDelayMs + 90}ms`,
      } as CSSProperties}
    >×{captureEffect?.pieceCount}</span> : null}
    {captureEffect?.pieces.map((piece) => <span
      key={`${captureEffect.id}:${piece.id}`}
      className="piece-token capture-ghost"
      aria-hidden="true"
      style={{
        left: `${piece.sourceLeft}%`,
        top: `${piece.sourceTop}%`,
        '--piece-color': piece.color,
        translate: '-50% -50%',
        '--capture-source-left': `${piece.sourceLeft}%`,
        '--capture-source-top': `${piece.sourceTop}%`,
        '--capture-target-left': `${piece.targetLeft}%`,
        '--capture-target-top': `${piece.targetTop}%`,
        '--capture-rotation': `${piece.rotation}deg`,
        '--capture-mid-rotation': `${piece.midRotation}deg`,
        '--capture-delay': `${piece.delayMs}ms`,
        '--capture-arc-height': `${piece.arcHeight}px`,
        '--capture-end-scale': piece.endScale,
      } as CSSProperties}
    ><PieceFigure /></span>)}
    {finishEffect?.pieces.map((piece) => <span
      key={`${finishEffect.id}:${piece.id}`}
      className="piece-token finish-ghost"
      aria-hidden="true"
      style={{
        left: `${piece.sourceLeft}%`,
        top: `${piece.sourceTop}%`,
        '--piece-color': piece.color,
        translate: '-50% -50%',
        '--finish-source-left': `${piece.sourceLeft}%`,
        '--finish-source-top': `${piece.sourceTop}%`,
        '--finish-target-left': `${piece.targetLeft}%`,
        '--finish-target-top': `${piece.targetTop}%`,
        '--finish-rotation': `${piece.rotation}deg`,
        '--finish-mid-rotation': `${piece.midRotation}deg`,
        '--finish-delay': `${piece.delayMs}ms`,
      } as CSSProperties}
    ><PieceFigure /></span>)}
    {finishEffect?.pieces.map((piece) => <span
      key={`${finishEffect.id}:launch:${piece.id}`}
      className="finish-launch-wave"
      aria-hidden="true"
      style={{
        left: `${piece.sourceLeft}%`,
        top: `${piece.sourceTop}%`,
        '--finish-delay': `${piece.delayMs}ms`,
      } as CSSProperties}
    />)}
    {finishSource ? <span
      className="finish-complete-label"
      aria-hidden="true"
      style={{ left: `${finishSource.sourceLeft}%`, top: `${finishSource.sourceTop - 10}%` }}
    >완주!</span> : null}
  </div>;
}
