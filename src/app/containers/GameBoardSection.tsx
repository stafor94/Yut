import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GameBoard, type BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import { subscribeGameState } from '../../features/room/services/roomService';
import type { BoardItem, BranchChoice } from '../../game-core/board/board';
import type { CaptureVisualEffect } from '../flows/captureAnimation';
import type { FinishVisualEffect } from '../flows/finishAnimation';
import {
  MOVE_FRAME_PRESENTATION_MS,
  gameAnimationQueue,
  waitForGameAnimation,
} from '../flows/gameAnimationQueue';
import { STORAGE_KEYS, type FallEffect, type Seat, type TrapEffect, type TrapNode } from '../appState';

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
  shieldedPieceIds: string[];
  previewNodeIds: string[];
  branchChoice: BranchChoice;
  onBranchChoiceChange: (choice: BranchChoice) => void;
  captureEffect: CaptureVisualEffect | null;
  captureDestinationNodeId: string;
  finishEffect: FinishVisualEffect | null;
  trapEffect: TrapEffect | null;
  fallEffect: FallEffect | null;
  trapPlacementNodeIds: string[];
  onSelectTrapNode: (nodeId: string) => void;
};

const getPieceFrameKey = (pieces: BoardPiece[]) => pieces
  .map((piece) => `${piece.id}:${piece.nodeId}:${piece.started ? 1 : 0}:${piece.finished ? 1 : 0}:${piece.previousNodeId ?? ''}`)
  .join('|');

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
  shieldedPieceIds,
  previewNodeIds,
  branchChoice,
  onBranchChoiceChange,
  captureEffect,
  captureDestinationNodeId,
  finishEffect,
  trapEffect,
  fallEffect,
  trapPlacementNodeIds,
  onSelectTrapNode,
}: GameBoardSectionProps) {
  const mountedRef = useRef(true);
  const [presentedPieces, setPresentedPieces] = useState<BoardPiece[]>(() => pieces.map((piece) => ({ ...piece })));
  const [presentedMovingPieceId, setPresentedMovingPieceId] = useState(movingPieceId);
  const [trapPlacementDeadlineAt, setTrapPlacementDeadlineAt] = useState(0);
  const [trapPlacementClock, setTrapPlacementClock] = useState(() => Date.now());

  useLayoutEffect(() => {
    mountedRef.current = true;
    const releaseQueue = gameAnimationQueue.acquire();
    return () => {
      mountedRef.current = false;
      releaseQueue();
    };
  }, []);

  useLayoutEffect(() => {
    const framePieces = pieces.map((piece) => ({ ...piece }));
    const frameKey = getPieceFrameKey(framePieces);
    const shouldQueueFrame = Boolean(movingPieceId) || gameAnimationQueue.isBusy();

    if (!shouldQueueFrame) {
      setPresentedPieces(framePieces);
      setPresentedMovingPieceId('');
      return;
    }

    void gameAnimationQueue.enqueue(`move:${movingPieceId || 'settled'}:${frameKey}`, async () => {
      if (!mountedRef.current) return;
      setPresentedPieces(framePieces);
      setPresentedMovingPieceId(movingPieceId);
      if (movingPieceId) await waitForGameAnimation(MOVE_FRAME_PRESENTATION_MS);
    });
  }, [movingPieceId, pieces]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
    if (!roomId) return undefined;
    return subscribeGameState(roomId, (state) => {
      const syncedState = state as { turnDeadlineAt?: unknown; turnDeadlineKind?: unknown; pendingTrapPlacement?: { deadline?: unknown } | null } | null;
      const deadline = Number(syncedState?.pendingTrapPlacement?.deadline ?? syncedState?.turnDeadlineAt ?? 0);
      const isTrapDeadline = syncedState?.turnDeadlineKind === 'trap_placement';
      setTrapPlacementDeadlineAt(isTrapDeadline && Number.isFinite(deadline) && deadline > 0 ? deadline : 0);
      setTrapPlacementClock(Date.now());
    });
  }, []);

  useEffect(() => {
    if (!trapPlacementNodeIds.length || !trapPlacementDeadlineAt || typeof window === 'undefined') return undefined;
    const remainingMs = trapPlacementDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      setTrapPlacementClock(Date.now());
      return undefined;
    }
    const timer = window.setTimeout(() => setTrapPlacementClock(Date.now()), remainingMs);
    return () => window.clearTimeout(timer);
  }, [trapPlacementDeadlineAt, trapPlacementNodeIds.length]);

  const selectedPieceIds = selectedGroupPieceIds.length ? selectedGroupPieceIds : activeMovablePiece ? [activeMovablePiece.id] : [];
  const trapAffectedPieceIds = trapEffect?.pieceIds ?? [];
  const trapNodeIds = trapNodes.map((trap) => trap.nodeId);
  const trapPlacementExpired = Boolean(trapPlacementDeadlineAt && trapPlacementClock >= trapPlacementDeadlineAt);

  return <GameBoard
    pieces={presentedPieces}
    items={boardItems}
    selectedPieceId={selectedPieceId || activeMovablePiece?.id}
    selectedPieceIds={selectedPieceIds}
    movingPieceId={presentedMovingPieceId}
    onSelectPiece={(pieceId) => {
      const targetPiece = presentedPieces.find((piece) => piece.id === pieceId);
      if (!targetPiece || !isMyTurn || !activeSeat || !canSeatControlPiece(activeSeat, targetPiece)) return;
      onSelectPieceId(pieceId);
    }}
    getPieceGroupKey={getPieceSideKey}
    revealedItems={revealedItems}
    highlightedNodeId={highlightedNodeId}
    trapNodeIds={trapNodeIds}
    shieldedPieceIds={shieldedPieceIds}
    previewNodeIds={previewNodeIds}
    branchChoice={branchChoice}
    onBranchChoiceChange={onBranchChoiceChange}
    showBranchControls={false}
    capturedPieceIds={trapAffectedPieceIds}
    captureEffect={captureEffect}
    captureDestinationNodeId={captureDestinationNodeId}
    finishEffect={finishEffect}
    trapEffectNodeId={trapEffect?.nodeId}
    selectableNodeIds={trapPlacementExpired ? [] : trapPlacementNodeIds}
    onSelectNode={(nodeId) => {
      if (trapPlacementExpired || (trapPlacementDeadlineAt && Date.now() >= trapPlacementDeadlineAt)) return;
      onSelectTrapNode(nodeId);
    }}
    boardShaking={Boolean(captureEffect)}
    showFallEffect={Boolean(fallEffect)}
    isPieceSelectable={(piece) => Boolean(isMyTurn && activeSeat && canSeatControlPiece(activeSeat, piece))}
  />;
}
