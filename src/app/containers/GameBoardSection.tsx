import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GameBoard, type BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import type { BoardItem, BranchChoice } from '../../game-core/board/board';
import { playConfirmedStackSoundEffect } from '../../shared/audio/sound';
import { createCaptureVisualEffect, type CaptureVisualEffect } from '../flows/captureAnimation';
import { enqueueCapturePresentation } from '../flows/capturePresentationQueue';
import type { FinishVisualEffect } from '../flows/finishAnimation';
import {
  MOVE_FRAME_PRESENTATION_MS,
  gameAnimationQueue,
  waitForGameAnimation,
} from '../flows/gameAnimationQueue';
import { localMovePresentationLifecycle } from '../flows/localMovePresentationLifecycle';
import {
  acceptMovePresentationFrame,
  createMovePresentationSession,
  getCapturePresentationSignature,
  getMovePresentationFinalization,
  getMovePresentationFrameKey,
  type MovePresentationSession,
} from '../flows/movePresentation';
import { createPresentationRevisionGate } from '../flows/presentationRevision';
import { type FallEffect, type Seat, type TrapEffect, type TrapNode } from '../appState';

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
  trapPlacementDeadlineAt: number;
  onSelectTrapNode: (nodeId: string) => void;
};

const clonePieces = (pieces: BoardPiece[]) => pieces.map((piece) => ({ ...piece }));
const CAPTURE_DUPLICATE_WINDOW_MS = 3000;
const STACK_SOUND_DELAY_MS = 120;

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
  trapPlacementDeadlineAt,
  onSelectTrapNode,
}: GameBoardSectionProps) {
  const mountedRef = useRef(true);
  const moveSessionRef = useRef<MovePresentationSession<BoardPiece> | null>(null);
  const pendingSettlementPiecesRef = useRef<BoardPiece[]>(clonePieces(pieces));
  const pendingCaptureEffectRef = useRef<CaptureVisualEffect | null>(null);
  const pendingLocalMovePathNodeIdsRef = useRef<string[]>([]);
  const moveFinalizationScheduledRef = useRef(false);
  const settlementRevisionGateRef = useRef(createPresentationRevisionGate());
  const lastCapturePresentationRef = useRef({ signature: '', queuedAt: 0 });
  const [presentedPieces, setPresentedPieces] = useState<BoardPiece[]>(() => clonePieces(pieces));
  const [presentedMovingPieceId, setPresentedMovingPieceId] = useState(movingPieceId);
  const [presentedCaptureEffect, setPresentedCaptureEffect] = useState<CaptureVisualEffect | null>(null);
  const [trapPlacementClock, setTrapPlacementClock] = useState(() => Date.now());

  useLayoutEffect(() => {
    mountedRef.current = true;
    const releaseQueue = gameAnimationQueue.acquire();
    return () => {
      mountedRef.current = false;
      moveSessionRef.current = null;
      pendingCaptureEffectRef.current = null;
      pendingLocalMovePathNodeIdsRef.current = [];
      moveFinalizationScheduledRef.current = false;
      settlementRevisionGateRef.current.invalidate();
      localMovePresentationLifecycle.cancel();
      releaseQueue();
    };
  }, []);

  useLayoutEffect(() => {
    if (movingPieceId || !previewNodeIds.length) return;
    pendingLocalMovePathNodeIdsRef.current = [...previewNodeIds];
  }, [movingPieceId, previewNodeIds]);

  const queueCaptureEffect = (queuedEffect: CaptureVisualEffect) => {
    const signature = getCapturePresentationSignature(queuedEffect);
    const now = Date.now();
    if (
      lastCapturePresentationRef.current.signature === signature
      && now - lastCapturePresentationRef.current.queuedAt < CAPTURE_DUPLICATE_WINDOW_MS
    ) return;

    lastCapturePresentationRef.current = { signature, queuedAt: now };
    let presented = false;
    void enqueueCapturePresentation({
      key: `capture:${signature}:${queuedEffect.id}`,
      durationMs: queuedEffect.durationMs,
      start: () => {
        if (!mountedRef.current) return false;
        presented = true;
        setPresentedCaptureEffect(queuedEffect);
      },
    }).finally(() => {
      if (!presented || !mountedRef.current) return;
      setPresentedCaptureEffect((current) => current?.id === queuedEffect.id ? null : current);
    });
  };

  useLayoutEffect(() => {
    const incomingPieces = clonePieces(pieces);
    pendingSettlementPiecesRef.current = incomingPieces;
    const settlementRevision = settlementRevisionGateRef.current.issue();

    if (movingPieceId) {
      const incomingMovingPiece = incomingPieces.find((piece) => piece.id === movingPieceId);
      localMovePresentationLifecycle.observe(
        movingPieceId,
        incomingMovingPiece?.nodeId ?? '',
        pendingLocalMovePathNodeIdsRef.current,
      );
      moveFinalizationScheduledRef.current = false;
      let session = moveSessionRef.current;
      if (!session || session.pieceId !== movingPieceId) {
        session = createMovePresentationSession(incomingPieces, movingPieceId, getPieceSideKey);
        moveSessionRef.current = session;
        pendingCaptureEffectRef.current = null;
      }
      if (!session) return;

      const acceptedFrame = acceptMovePresentationFrame(session, incomingPieces);
      if (!acceptedFrame.accepted) return;
      moveSessionRef.current = acceptedFrame.session;
      if (!acceptedFrame.changed) return;

      const framePieces = acceptedFrame.pieces;
      void gameAnimationQueue.enqueue(`move:${movingPieceId}:${acceptedFrame.frameKey}`, async () => {
        if (!mountedRef.current) return;
        setPresentedPieces(framePieces);
        setPresentedMovingPieceId(movingPieceId);
        await waitForGameAnimation(MOVE_FRAME_PRESENTATION_MS);
      });
      return;
    }

    const activeSession = moveSessionRef.current;
    if (activeSession) {
      moveFinalizationScheduledRef.current = true;
      queueMicrotask(() => {
        if (!mountedRef.current
          || moveSessionRef.current !== activeSession
          || !settlementRevisionGateRef.current.isCurrent(settlementRevision)) return;
        const settlementPieces = clonePieces(pendingSettlementPiecesRef.current);
        const finalization = getMovePresentationFinalization(activeSession, settlementPieces, getPieceSideKey);
        let queuedEffect = pendingCaptureEffectRef.current;
        pendingCaptureEffectRef.current = null;
        if (!queuedEffect && finalization.capturedPieceIds.length) {
          queuedEffect = createCaptureVisualEffect({
            id: Date.now(),
            pieceIds: finalization.capturedPieceIds,
            pieces: activeSession.acceptedPieces,
            attackerPieceId: activeSession.pieceId,
            getPieceGroupKey: getPieceSideKey,
          });
        }
        if (queuedEffect) queueCaptureEffect(queuedEffect);

        const settlementKey = getMovePresentationFrameKey(settlementPieces);
        void gameAnimationQueue.enqueue(`move:settled:${activeSession.pieceId}:${settlementKey}`, async () => {
          if (!mountedRef.current
            || moveSessionRef.current !== activeSession
            || !settlementRevisionGateRef.current.isCurrent(settlementRevision)) return;
          setPresentedPieces(settlementPieces);
          setPresentedMovingPieceId('');
          moveSessionRef.current = null;
          moveFinalizationScheduledRef.current = false;
          if (localMovePresentationLifecycle.settle(activeSession.pieceId)) {
            pendingLocalMovePathNodeIdsRef.current = [];
          }
          if (finalization.shouldPlayStackSound) {
            window.setTimeout(playConfirmedStackSoundEffect, STACK_SOUND_DELAY_MS);
          }
        });
      });
      return;
    }

    const frameKey = getMovePresentationFrameKey(incomingPieces);
    if (!gameAnimationQueue.isBusy()) {
      setPresentedPieces(incomingPieces);
      setPresentedMovingPieceId('');
      localMovePresentationLifecycle.settle();
      return;
    }

    void gameAnimationQueue.enqueue(`move:settled:${frameKey}`, async () => {
      if (!mountedRef.current || !settlementRevisionGateRef.current.isCurrent(settlementRevision)) return;
      setPresentedPieces(incomingPieces);
      setPresentedMovingPieceId('');
      localMovePresentationLifecycle.settle();
    });
  }, [getPieceSideKey, movingPieceId, pieces]);

  useLayoutEffect(() => {
    if (!captureEffect) return;
    const queuedEffect = {
      ...captureEffect,
      pieceIds: [...captureEffect.pieceIds],
      pieces: captureEffect.pieces.map((piece) => ({ ...piece })),
      attackerPieceIds: [...captureEffect.attackerPieceIds],
    };
    if (moveSessionRef.current || movingPieceId) {
      pendingCaptureEffectRef.current = queuedEffect;
      return;
    }
    queueCaptureEffect(queuedEffect);
  }, [captureEffect, movingPieceId]);

  useEffect(() => {
    setTrapPlacementClock(Date.now());
  }, [trapPlacementDeadlineAt]);

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
    captureEffect={presentedCaptureEffect}
    captureDestinationNodeId={captureDestinationNodeId}
    finishEffect={finishEffect}
    trapEffectNodeId={trapEffect?.nodeId}
    selectableNodeIds={trapPlacementExpired ? [] : trapPlacementNodeIds}
    onSelectNode={(nodeId) => {
      if (trapPlacementExpired || (trapPlacementDeadlineAt && Date.now() >= trapPlacementDeadlineAt)) return;
      onSelectTrapNode(nodeId);
    }}
    boardShaking={Boolean(presentedCaptureEffect)}
    showFallEffect={Boolean(fallEffect)}
    isPieceSelectable={(piece) => Boolean(isMyTurn && activeSeat && canSeatControlPiece(activeSeat, piece))}
  />;
}
