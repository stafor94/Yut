import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  createMoveFrameCompletionGate,
  type MoveFrameCompletionGate,
} from '../flows/moveFrameCompletion';
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
const STACK_SOUND_DELAY_MS = 120;

function isCaptureApproachFrame({
  pieces,
  movingPieceId,
  captureDestinationNodeId,
  shieldedPieceIds,
  getPieceSideKey,
}: {
  pieces: BoardPiece[];
  movingPieceId: string;
  captureDestinationNodeId: string;
  shieldedPieceIds: string[];
  getPieceSideKey: (piece: BoardPiece) => string;
}) {
  if (!movingPieceId || !captureDestinationNodeId) return false;
  const attacker = pieces.find((piece) => piece.id === movingPieceId);
  if (!attacker || attacker.nodeId !== captureDestinationNodeId || attacker.finished) return false;
  const attackerSideKey = getPieceSideKey(attacker);
  return pieces.some((piece) => piece.id !== movingPieceId
    && piece.started
    && !piece.finished
    && piece.nodeId === attacker.nodeId
    && getPieceSideKey(piece) !== attackerSideKey
    && !shieldedPieceIds.includes(piece.id));
}

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
  const settledPresentationPiecesRef = useRef<BoardPiece[]>(clonePieces(pieces));
  const moveGenerationRef = useRef(0);
  const moveFrameCompletionGateRef = useRef<MoveFrameCompletionGate | null>(null);
  const pendingSettlementPiecesRef = useRef<BoardPiece[]>(clonePieces(pieces));
  const pendingCaptureEffectRef = useRef<CaptureVisualEffect | null>(null);
  const pendingCaptureFinalizationRef = useRef<((queuedEffect: CaptureVisualEffect) => void) | null>(null);
  const moveFinalizationScheduledRef = useRef(false);
  const settlementRevisionGateRef = useRef(createPresentationRevisionGate());
  const presentedCaptureKeysRef = useRef<Set<string>>(new Set());
  const presentedCaptureSignaturesRef = useRef<Set<string>>(new Set());
  const previewDestinationNodeIdRef = useRef(previewNodeIds[previewNodeIds.length - 1] ?? '');
  const activeMoveDestinationRef = useRef({ pieceId: '', nodeId: '' });
  const [presentedPieces, setPresentedPieces] = useState<BoardPiece[]>(() => clonePieces(pieces));
  const [presentedMovingPieceId, setPresentedMovingPieceId] = useState(movingPieceId);
  const [presentedMovingFrameKey, setPresentedMovingFrameKey] = useState('');
  const [presentedCaptureEffect, setPresentedCaptureEffect] = useState<CaptureVisualEffect | null>(null);
  const [trapPlacementClock, setTrapPlacementClock] = useState(() => Date.now());

  useLayoutEffect(() => {
    if (movingPieceId || moveSessionRef.current) return;
    previewDestinationNodeIdRef.current = previewNodeIds[previewNodeIds.length - 1] ?? '';
  }, [movingPieceId, previewNodeIds]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    const releaseQueue = gameAnimationQueue.acquire();
    const cancelActiveMoveFrame = () => {
      moveGenerationRef.current += 1;
      moveFrameCompletionGateRef.current?.cancel();
      moveFrameCompletionGateRef.current = null;
    };
    const unsubscribeQueueReset = gameAnimationQueue.onReset?.(cancelActiveMoveFrame) ?? (() => undefined);
    return () => {
      mountedRef.current = false;
      unsubscribeQueueReset();
      cancelActiveMoveFrame();
      moveSessionRef.current = null;
      pendingCaptureEffectRef.current = null;
      pendingCaptureFinalizationRef.current = null;
      activeMoveDestinationRef.current = { pieceId: '', nodeId: '' };
      moveFinalizationScheduledRef.current = false;
      settlementRevisionGateRef.current.invalidate();
      localMovePresentationLifecycle.cancel();
      releaseQueue();
    };
  }, []);

  const handleMovingPieceTransitionPrepared = useCallback((pieceId: string, frameKey: string, durationMs: number) => {
    const gate = moveFrameCompletionGateRef.current;
    if (!gate || gate.pieceId !== pieceId || gate.frameKey !== frameKey) return;
    gate.armFallback({ pieceId, frameKey }, durationMs);
  }, []);

  const handleMovingPieceTransitionComplete = useCallback((pieceId: string, frameKey: string) => {
    moveFrameCompletionGateRef.current?.complete({ pieceId, frameKey });
  }, []);

  const queueCaptureEffect = (queuedEffect: CaptureVisualEffect) => {
    const signature = getCapturePresentationSignature(queuedEffect);
    if (presentedCaptureKeysRef.current.has(queuedEffect.presentationKey)
      || presentedCaptureSignaturesRef.current.has(signature)) return;
    presentedCaptureKeysRef.current.add(queuedEffect.presentationKey);
    presentedCaptureSignaturesRef.current.add(signature);
    let presented = false;
    void enqueueCapturePresentation({
      key: `capture:${queuedEffect.presentationKey}`,
      durationMs: queuedEffect.durationMs,
      start: () => {
        if (!mountedRef.current) return false;
        presented = true;
        setPresentedCaptureEffect(queuedEffect);
      },
    }).finally(() => {
      if (!presented || !mountedRef.current) return;
      setPresentedCaptureEffect((current) => current?.presentationKey === queuedEffect.presentationKey ? null : current);
    });
  };

  useLayoutEffect(() => {
    const incomingPieces = clonePieces(pieces);
    pendingSettlementPiecesRef.current = incomingPieces;
    const settlementRevision = settlementRevisionGateRef.current.issue();

    if (movingPieceId) {
      const incomingMovingPiece = incomingPieces.find((piece) => piece.id === movingPieceId);
      localMovePresentationLifecycle.observe(movingPieceId, incomingMovingPiece?.nodeId ?? '');
      moveFinalizationScheduledRef.current = false;
      let session = moveSessionRef.current;
      if (!session || session.pieceId !== movingPieceId) {
        moveFrameCompletionGateRef.current?.cancel();
        moveFrameCompletionGateRef.current = null;
        pendingCaptureFinalizationRef.current = null;
        moveGenerationRef.current += 1;
        const stablePieces = settledPresentationPiecesRef.current.some((piece) => piece.id === movingPieceId)
          ? clonePieces(settledPresentationPiecesRef.current)
          : incomingPieces;
        session = createMovePresentationSession(stablePieces, movingPieceId, getPieceSideKey);
        moveSessionRef.current = session;
        pendingCaptureEffectRef.current = null;
        activeMoveDestinationRef.current = {
          pieceId: movingPieceId,
          nodeId: captureDestinationNodeId || previewDestinationNodeIdRef.current,
        };
      } else if (activeMoveDestinationRef.current.pieceId !== movingPieceId) {
        activeMoveDestinationRef.current = {
          pieceId: movingPieceId,
          nodeId: captureDestinationNodeId || previewDestinationNodeIdRef.current,
        };
      } else if (!activeMoveDestinationRef.current.nodeId && captureDestinationNodeId) {
        activeMoveDestinationRef.current = { pieceId: movingPieceId, nodeId: captureDestinationNodeId };
      }
      if (!session) return;

      const acceptedFrame = acceptMovePresentationFrame(session, incomingPieces);
      if (!acceptedFrame.accepted) return;
      moveSessionRef.current = acceptedFrame.session;
      if (!acceptedFrame.changed) return;

      const framePieces = acceptedFrame.pieces;
      const retainedDestinationNodeId = activeMoveDestinationRef.current.pieceId === movingPieceId
        ? activeMoveDestinationRef.current.nodeId
        : '';
      const awaitArrivalTransition = isCaptureApproachFrame({
        pieces: framePieces,
        movingPieceId,
        captureDestinationNodeId: retainedDestinationNodeId || captureDestinationNodeId,
        shieldedPieceIds,
        getPieceSideKey,
      });
      const framePresentationKey = awaitArrivalTransition
        ? `${moveGenerationRef.current}:${acceptedFrame.frameKey}`
        : '';
      const queueFrameKey = framePresentationKey || acceptedFrame.frameKey;
      void gameAnimationQueue.enqueue(`move:${movingPieceId}:${queueFrameKey}`, async () => {
        if (!mountedRef.current) return;
        let frameCompletionGate: MoveFrameCompletionGate | null = null;
        if (awaitArrivalTransition) {
          frameCompletionGate = createMoveFrameCompletionGate({ pieceId: movingPieceId, frameKey: framePresentationKey });
          moveFrameCompletionGateRef.current?.cancel();
          moveFrameCompletionGateRef.current = frameCompletionGate;
          setPresentedMovingFrameKey(framePresentationKey);
        } else {
          setPresentedMovingFrameKey('');
        }
        setPresentedPieces(framePieces);
        setPresentedMovingPieceId(movingPieceId);
        if (!frameCompletionGate) {
          await waitForGameAnimation(MOVE_FRAME_PRESENTATION_MS);
          return;
        }
        await frameCompletionGate.promise;
        if (moveFrameCompletionGateRef.current === frameCompletionGate) {
          moveFrameCompletionGateRef.current = null;
        }
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
        const settlementKey = getMovePresentationFrameKey(settlementPieces);
        const scheduleSettlement = () => {
          void gameAnimationQueue.enqueue(`move:settled:${activeSession.pieceId}:${settlementKey}`, async () => {
            if (!mountedRef.current
              || moveSessionRef.current !== activeSession
              || !settlementRevisionGateRef.current.isCurrent(settlementRevision)) return;
            const settledPieces = clonePieces(settlementPieces);
            settledPresentationPiecesRef.current = settledPieces;
            setPresentedPieces(settledPieces);
            setPresentedMovingPieceId('');
            setPresentedMovingFrameKey('');
            activeMoveDestinationRef.current = { pieceId: '', nodeId: '' };
            moveSessionRef.current = null;
            pendingCaptureFinalizationRef.current = null;
            moveFinalizationScheduledRef.current = false;
            localMovePresentationLifecycle.settle(activeSession.pieceId);
            if (finalization.shouldPlayStackSound) {
              window.setTimeout(playConfirmedStackSoundEffect, STACK_SOUND_DELAY_MS);
            }
          });
        };
        const queueCaptureThenSettlement = (queuedEffect: CaptureVisualEffect) => {
          if (!mountedRef.current
            || moveSessionRef.current !== activeSession
            || !settlementRevisionGateRef.current.isCurrent(settlementRevision)) return;
          pendingCaptureFinalizationRef.current = null;
          pendingCaptureEffectRef.current = null;
          queueCaptureEffect(queuedEffect);
          scheduleSettlement();
        };

        if (finalization.capturedPieceIds.length > 0) {
          const queuedEffect = pendingCaptureEffectRef.current
            ?? (captureEffect ? {
              ...captureEffect,
              pieceIds: [...captureEffect.pieceIds],
              pieces: captureEffect.pieces.map((piece) => ({ ...piece })),
              attackerPieceIds: [...captureEffect.attackerPieceIds],
            } : null)
            ?? createCaptureVisualEffect({
              id: Date.now(),
              presentationKey: `capture-effect:${activeSession.pieceId}:${settlementKey}`,
              pieceIds: finalization.capturedPieceIds,
              pieces: activeSession.acceptedPieces,
              attackerPieceId: activeSession.pieceId,
              getPieceGroupKey: getPieceSideKey,
            });
          if (queuedEffect) {
            queueCaptureThenSettlement(queuedEffect);
            return;
          }
          pendingCaptureFinalizationRef.current = queueCaptureThenSettlement;
          return;
        }
        scheduleSettlement();
      });
      return;
    }

    const frameKey = getMovePresentationFrameKey(incomingPieces);
    if (!gameAnimationQueue.isBusy()) {
      settledPresentationPiecesRef.current = clonePieces(incomingPieces);
      setPresentedPieces(incomingPieces);
      setPresentedMovingPieceId('');
      setPresentedMovingFrameKey('');
      activeMoveDestinationRef.current = { pieceId: '', nodeId: '' };
      localMovePresentationLifecycle.settle();
      return;
    }

    void gameAnimationQueue.enqueue(`move:settled:${frameKey}`, async () => {
      if (!mountedRef.current || !settlementRevisionGateRef.current.isCurrent(settlementRevision)) return;
      const settledPieces = clonePieces(incomingPieces);
      settledPresentationPiecesRef.current = settledPieces;
      setPresentedPieces(settledPieces);
      setPresentedMovingPieceId('');
      setPresentedMovingFrameKey('');
      activeMoveDestinationRef.current = { pieceId: '', nodeId: '' };
      localMovePresentationLifecycle.settle();
    });
  }, [captureDestinationNodeId, captureEffect, getPieceSideKey, movingPieceId, pieces, shieldedPieceIds]);

  useLayoutEffect(() => {
    if (!captureEffect) return;
    const queuedEffect = {
      ...captureEffect,
      pieceIds: [...captureEffect.pieceIds],
      pieces: captureEffect.pieces.map((piece) => ({ ...piece })),
      attackerPieceIds: [...captureEffect.attackerPieceIds],
    };
    if (movingPieceId) {
      pendingCaptureEffectRef.current = queuedEffect;
      return;
    }
    const finalizeCapture = pendingCaptureFinalizationRef.current;
    if (finalizeCapture) {
      pendingCaptureEffectRef.current = queuedEffect;
      finalizeCapture(queuedEffect);
      return;
    }
    if (moveSessionRef.current) {
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
  const presentedCaptureDestinationNodeId = activeMoveDestinationRef.current.pieceId === presentedMovingPieceId
    ? activeMoveDestinationRef.current.nodeId
    : captureDestinationNodeId;

  return <GameBoard
    pieces={presentedPieces}
    items={boardItems}
    selectedPieceId={selectedPieceId || activeMovablePiece?.id}
    selectedPieceIds={selectedPieceIds}
    movingPieceId={presentedMovingPieceId}
    movingPieceFrameKey={presentedMovingFrameKey}
    onMovingPieceTransitionPrepared={handleMovingPieceTransitionPrepared}
    onMovingPieceTransitionComplete={handleMovingPieceTransitionComplete}
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
    captureDestinationNodeId={presentedCaptureDestinationNodeId}
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