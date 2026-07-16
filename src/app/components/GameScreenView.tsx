import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import { commitAuthoritativeGameAction } from '../../features/room/services/roomService';
import { getMovePathNodeIdsWithPrevious, type BoardItem, type BranchChoice } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import { STORAGE_KEYS, type CaptureEffect, type FallEffect, type GameLog, type RollAnimation, type Seat, type ToastMessage, type TrapEffect, type TrapNode, type TurnOrderIntro, type TurnOrderPhase } from '../appState';
import {
  CAPTURE_IMPACT_DELAY_MS,
  createCaptureVisualEffect,
  inferCapturedPieceIds,
  type CaptureVisualEffect,
} from '../flows/captureAnimation';
import {
  createFinishVisualEffect,
  inferFinishedPieceIds,
  type FinishVisualEffect,
} from '../flows/finishAnimation';
import {
  bindPendingFallPresentationEffect,
  createPendingFallPresentationCompletion,
  shouldClearPendingFallPresentation,
  type PendingFallPresentationCompletion,
} from '../flows/fallPresentationCompletion';
import { getGamePresentationTurn } from '../flows/gamePresentationTurn';
import {
  EMPTY_ROLL_PRESENTATION_STATE,
  shouldDeferRollDerivedContent,
  type RollPresentationState,
} from '../flows/rollPresentationVisibility';
import { getRollOutcomeSoundEffect, shouldPlayPerfectRollSound } from '../flows/rollSound';
import { BoardPanel, GameScreen } from '../screens/GameScreen';
import { GameLogPanelView, GamePlayersPanel } from '../containers/GamePanels';
import { BoardMessageStack, GoldenYutPicker, RollStage, TurnIndicator, WinnerOverlay } from '../containers/GameBoardOverlays';
import { GameBoardControls } from '../containers/GameBoardControls';
import { GameBoardSection } from '../containers/GameBoardSection';
import { TurnOrderIntroOverlay } from './TurnOrderIntroOverlay';

type GameScreenViewProps = {
  activeItemPromptTypes: ItemType[];
  activeMovablePiece: BoardPiece | undefined;
  activeRoomTitle: string;
  activeSeat: Seat | undefined;
  activeTurnOrderIntro: TurnOrderIntro | null;
  boardItems: BoardItem[];
  boardTurnIndicatorColor: string | undefined;
  boardTurnIndicatorText: ReactNode;
  boardTurnIndicatorRollStack: YutResult[];
  branchChoice: BranchChoice;
  canContinueRace: boolean;
  canRequestMove: boolean;
  canRollNow: boolean;
  canRollForTurnOrderNow: boolean;
  canSeatControlPiece: (seat: Seat | undefined, piece: BoardPiece | undefined) => boolean;
  canSubmitTurnAction: boolean;
  captureEffect: CaptureEffect | null;
  fallEffect: FallEffect | null;
  displayBranchChoice: BranchChoice;
  finalHoldMs: number;
  formatStoredLogSequence: (log: GameLog, displayIndex?: number) => string;
  getItemPromptTimeoutMs: (seatId?: string) => number;
  getLogCardStyle: (text: string, previousText?: string) => React.CSSProperties;
  getPieceSideKey: (piece: BoardPiece) => string;
  getPlayerCardName: (seat: Seat) => string;
  getSeatPieceColor: (seat: Seat | undefined) => string;
  getTurnActionTimeoutMs: (seatId?: string) => number;
  goldenYutChoices: YutResult[];
  goldenYutPickerOpen: boolean;
  hasActiveTurnOrderIntro: boolean;
  highlightedNodeId: string;
  isMyTurn: boolean;
  localSeatId: string;
  logs: GameLog[];
  movingPieceId: string;
  ownedItems: Record<string, ItemType[]>;
  pendingTrapPlacement: boolean;
  playMode: 'individual' | 'team';
  maxPlayers: 2 | 3 | 4;
  pieceCount: 1 | 2 | 3 | 4;
  itemMode: boolean;
  stackedRollMode: boolean;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  onSelectRollStackIndex: (index: number) => void;
  onMoveRollStackIndex: (index: number) => void;
  moveSelectionTimedOut: boolean;
  previewNodeIds: string[];
  previousBoardTurnText: string;
  previousBoardTurnColor: string | undefined;
  nextBoardTurnText: string;
  nextBoardTurnColor: string | undefined;
  revealedItems: ItemType[];
  roll: YutResult | null;
  rollAnimation: RollAnimation | null;
  rollResultHolding: boolean;
  selectedGroupPieceIds: string[];
  selectedPieceId: string;
  shieldedPieceIds: string[];
  playerPanelSeats: Seat[];
  completedSeatIds: string[];
  rankingSeatIds: string[];
  seats: Seat[];
  showBottomBranchControls: boolean;
  showBoardTurnNeighbors: boolean;
  spectators: Seat[];
  title: string;
  activeSeatTurnText: string;
  toast: ToastMessage | null;
  trapEffect: TrapEffect | null;
  trapNodes: TrapNode[];
  trapPlacementNodeIds: string[];
  trapPlacementSecondsLeft: number;
  turnActionTimeoutMs: number;
  turnOrderClock: number;
  turnOrderPhase: TurnOrderPhase;
  turnToast: { id: number; text: string } | null;
  waitingForOnlineTurnOrder: boolean;
  winner: string;
  winnerText: ReactNode;
  onBranchChoiceChange: (choice: BranchChoice) => void;
  onContinueRace: () => void;
  onFinishGame: () => void;
  onReturnToWaitingRoom: () => void;
  onGoldenYutSelect: (choice: YutResult) => void;
  onMoveSelectedPiece: () => void;
  onOpenEndGameDialog: () => void;
  onOpenSequenceExportDialog: () => void;
  onRollYut: (timingPositionPercent?: number) => void;
  onSelectPieceId: (pieceId: string) => void;
  onSelectTrapNode: (nodeId: string) => void;
  onSkipItemPrompt: () => void;
  onUseItem: (type: ItemType, actorId?: string, remotePayload?: Record<string, unknown>) => Promise<void>;
  pieces: BoardPiece[];
  renderLogText: (text: string) => ReactNode;
};

const FALL_COMPLETION_RETRY_MS = 800;

export function GameScreenView({ activeItemPromptTypes, activeMovablePiece, activeRoomTitle, activeSeat, activeTurnOrderIntro, boardItems, boardTurnIndicatorColor, boardTurnIndicatorText, boardTurnIndicatorRollStack, branchChoice, canContinueRace, canRequestMove, canRollNow, canRollForTurnOrderNow, canSeatControlPiece, canSubmitTurnAction, captureEffect, fallEffect, displayBranchChoice, finalHoldMs, formatStoredLogSequence, getItemPromptTimeoutMs, getLogCardStyle, getPieceSideKey, getPlayerCardName, getSeatPieceColor, getTurnActionTimeoutMs, goldenYutChoices, goldenYutPickerOpen, hasActiveTurnOrderIntro, highlightedNodeId, isMyTurn, localSeatId, logs, movingPieceId, ownedItems, pendingTrapPlacement, pieces, playMode, maxPlayers, pieceCount, itemMode, stackedRollMode, rollStack, selectedRollStackIndex, rollStackClosed, onSelectRollStackIndex, onMoveRollStackIndex, moveSelectionTimedOut, previewNodeIds, previousBoardTurnText, previousBoardTurnColor, nextBoardTurnText, nextBoardTurnColor, revealedItems, roll, rollAnimation, rollResultHolding, selectedGroupPieceIds, selectedPieceId, shieldedPieceIds, playerPanelSeats, completedSeatIds, rankingSeatIds, seats, showBottomBranchControls, showBoardTurnNeighbors, spectators, title, activeSeatTurnText, toast, trapEffect, trapNodes, trapPlacementNodeIds, trapPlacementSecondsLeft, turnActionTimeoutMs, turnOrderClock, turnOrderPhase, turnToast, waitingForOnlineTurnOrder, winner, winnerText, onBranchChoiceChange, onContinueRace, onFinishGame, onReturnToWaitingRoom, onGoldenYutSelect, onMoveSelectedPiece, onOpenEndGameDialog, onOpenSequenceExportDialog, onRollYut, onSelectPieceId, onSelectTrapNode, onSkipItemPrompt, onUseItem, renderLogText }: GameScreenViewProps) {
  const lastRollAnimationIdRef = useRef('');
  const lastRollOutcomeKeyRef = useRef('');
  const lastPerfectRollKeyRef = useRef('');
  const previousPieceNodeIdsRef = useRef<Map<string, string>>(new Map());
  const previousPiecesRef = useRef<BoardPiece[]>([]);
  const previousMovingPieceIdRef = useRef('');
  const activeMovePieceIdRef = useRef('');
  const lastCaptureEffectIdRef = useRef('');
  const visualCaptureEffectRef = useRef<CaptureVisualEffect | null>(null);
  const captureClearTimerRef = useRef<number | null>(null);
  const captureSoundTimerRef = useRef<number | null>(null);
  const [visualCaptureEffect, setVisualCaptureEffect] = useState<CaptureVisualEffect | null>(null);
  const [captureDestinationNodeId, setCaptureDestinationNodeId] = useState('');
  const visualFinishEffectRef = useRef<FinishVisualEffect | null>(null);
  const finishClearTimerRef = useRef<number | null>(null);
  const [visualFinishEffect, setVisualFinishEffect] = useState<FinishVisualEffect | null>(null);
  const lastRevealedItemsKeyRef = useRef('');
  const stackCountsInitializedRef = useRef(false);
  const previousStackCountsRef = useRef<Map<string, number>>(new Map());
  const [rollPresentation, setRollPresentation] = useState<RollPresentationState>(EMPTY_ROLL_PRESENTATION_STATE);
  const pendingFallCompletionRef = useRef<PendingFallPresentationCompletion | null>(null);
  const completingFallKeyRef = useRef('');
  const [pendingFallActorId, setPendingFallActorId] = useState('');
  const [fallCompletionRetryToken, setFallCompletionRetryToken] = useState(0);
  const visibleBoardTurnIndicatorRollStackRef = useRef(boardTurnIndicatorRollStack);
  const visibleRollStackRef = useRef(rollStack);
  const visibleLogsRef = useRef(logs);
  const rollDerivedSnapshotsRef = useRef<Map<number, { boardRollStack: YutResult[]; rollStack: YutResult[]; logs: GameLog[] }>>(new Map());

  const handleRollPresentationChange = (nextPresentation: RollPresentationState) => {
    setRollPresentation(nextPresentation);
    if (!nextPresentation.active || nextPresentation.fallCount <= 0) return;
    const pending = createPendingFallPresentationCompletion({
      presentationActorId: nextPresentation.actorId,
      sourceAnimationId: nextPresentation.sourceAnimationId,
      fallEffect,
    });
    pendingFallCompletionRef.current = pending;
    if (pending.actorId) setPendingFallActorId(pending.actorId);
  };

  if (rollAnimation) {
    const existingSnapshot = rollDerivedSnapshotsRef.current.get(rollAnimation.id);
    if (existingSnapshot?.boardRollStack !== boardTurnIndicatorRollStack || existingSnapshot.rollStack !== rollStack || existingSnapshot.logs !== logs) {
      rollDerivedSnapshotsRef.current.set(rollAnimation.id, { boardRollStack: boardTurnIndicatorRollStack, rollStack, logs });
    }
    if (rollDerivedSnapshotsRef.current.size > 120) {
      rollDerivedSnapshotsRef.current = new Map(Array.from(rollDerivedSnapshotsRef.current.entries()).slice(-60));
    }
  }
  const deferRollDerivedContent = shouldDeferRollDerivedContent({
    rollAnimationId: rollAnimation?.id ?? null,
    presentation: rollPresentation,
  });
  const revealedRollSnapshot = rollPresentation.resultVisible && rollPresentation.sourceAnimationId !== null
    ? rollDerivedSnapshotsRef.current.get(rollPresentation.sourceAnimationId)
    : undefined;
  const displayedBoardTurnIndicatorRollStack = revealedRollSnapshot?.boardRollStack ?? (deferRollDerivedContent ? visibleBoardTurnIndicatorRollStackRef.current : boardTurnIndicatorRollStack);
  const displayedRollStack = revealedRollSnapshot?.rollStack ?? (deferRollDerivedContent ? visibleRollStackRef.current : rollStack);
  const displayedLogs = revealedRollSnapshot?.logs ?? (deferRollDerivedContent ? visibleLogsRef.current : logs);

  useLayoutEffect(() => {
    if (revealedRollSnapshot) {
      visibleBoardTurnIndicatorRollStackRef.current = revealedRollSnapshot.boardRollStack;
      visibleRollStackRef.current = revealedRollSnapshot.rollStack;
      visibleLogsRef.current = revealedRollSnapshot.logs;
      return;
    }
    if (deferRollDerivedContent) return;
    visibleBoardTurnIndicatorRollStackRef.current = boardTurnIndicatorRollStack;
    visibleRollStackRef.current = rollStack;
    visibleLogsRef.current = logs;
  }, [boardTurnIndicatorRollStack, deferRollDerivedContent, logs, revealedRollSnapshot, rollStack]);

  useEffect(() => {
    const pending = pendingFallCompletionRef.current;
    if (!pending || !fallEffect) return;
    const boundPending = bindPendingFallPresentationEffect(pending, fallEffect);
    if (boundPending.actorId === pending.actorId && boundPending.authoritativeEffectId === pending.authoritativeEffectId) return;
    pendingFallCompletionRef.current = boundPending;
    setPendingFallActorId(boundPending.actorId);
  }, [fallEffect]);

  useEffect(() => {
    if (rollPresentation.active) return undefined;
    const pending = pendingFallCompletionRef.current;
    if (!pending) return undefined;
    if (!fallEffect) {
      if (!shouldClearPendingFallPresentation(pending, fallEffect)) return undefined;
      pendingFallCompletionRef.current = null;
      completingFallKeyRef.current = '';
      setPendingFallActorId('');
      return undefined;
    }

    const authoritativePending = bindPendingFallPresentationEffect(pending, fallEffect);
    if (authoritativePending.actorId !== pending.actorId || authoritativePending.authoritativeEffectId !== pending.authoritativeEffectId) {
      pendingFallCompletionRef.current = authoritativePending;
      setPendingFallActorId(authoritativePending.actorId);
    }
    if (!authoritativePending.actorId) return undefined;

    const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
    if (!roomId) {
      pendingFallCompletionRef.current = null;
      completingFallKeyRef.current = '';
      setPendingFallActorId('');
      return undefined;
    }

    const completionKey = `${roomId}:${authoritativePending.actorId}:${authoritativePending.sourceAnimationId ?? authoritativePending.authoritativeEffectId ?? fallEffect.id}`;
    if (completingFallKeyRef.current === completionKey) return undefined;
    completingFallKeyRef.current = completionKey;
    let cancelled = false;

    void commitAuthoritativeGameAction(roomId, {
      type: 'roll_yut',
      actorId: authoritativePending.actorId,
      payload: {
        completeFallPresentation: true,
        clientActionId: `complete_fall_presentation:${completionKey}`,
      },
    }).catch(() => {
      if (cancelled) return;
      completingFallKeyRef.current = '';
      window.setTimeout(() => {
        if (!cancelled) setFallCompletionRetryToken((current) => current + 1);
      }, FALL_COMPLETION_RETRY_MS);
    });

    return () => {
      cancelled = true;
    };
  }, [fallCompletionRetryToken, fallEffect, pendingFallActorId, rollPresentation.active]);

  const activeGameSeatId = activeTurnOrderIntro || turnOrderPhase.active || waitingForOnlineTurnOrder ? undefined : activeSeat?.id;
  const frozenFallActorId = rollPresentation.active && rollPresentation.fallCount > 0
    ? rollPresentation.actorId || pendingFallActorId
    : pendingFallActorId;
  const presentationTurn = getGamePresentationTurn({
    activeSeatId: activeGameSeatId,
    localSeatId,
    presentationActorId: frozenFallActorId,
  });
  const presentationSeat = presentationTurn.isFrozen
    ? seats.find((seat) => seat.id === presentationTurn.activeSeatId)
      ?? playerPanelSeats.find((seat) => seat.id === presentationTurn.activeSeatId)
    : undefined;
  const displayedActiveSeat = presentationSeat ?? activeSeat;
  const displayedActiveGameSeatId = activeGameSeatId === undefined ? undefined : presentationTurn.activeSeatId || activeGameSeatId;
  const displayedIsMyTurn = presentationTurn.isFrozen ? presentationTurn.isMyTurn : isMyTurn;
  const displayedTurnText = presentationTurn.isFrozen && presentationSeat ? getPlayerCardName(presentationSeat) : boardTurnIndicatorText;
  const displayedTurnColor = presentationTurn.isFrozen && presentationSeat ? getSeatPieceColor(presentationSeat) : boardTurnIndicatorColor;
  const displayedActiveSeatTurnText = presentationTurn.isFrozen && presentationSeat ? getPlayerCardName(presentationSeat) : activeSeatTurnText;

  const startVisualCapture = (nextEffect: CaptureVisualEffect, playInferredSound: boolean) => {
    if (captureClearTimerRef.current !== null) window.clearTimeout(captureClearTimerRef.current);
    if (captureSoundTimerRef.current !== null) window.clearTimeout(captureSoundTimerRef.current);
    visualCaptureEffectRef.current = nextEffect;
    setVisualCaptureEffect(nextEffect);
    if (playInferredSound) {
      captureSoundTimerRef.current = window.setTimeout(() => {
        playStoredSoundEffect('capture');
        captureSoundTimerRef.current = null;
      }, CAPTURE_IMPACT_DELAY_MS);
    }
    captureClearTimerRef.current = window.setTimeout(() => {
      if (visualCaptureEffectRef.current?.id === nextEffect.id) {
        visualCaptureEffectRef.current = null;
        setVisualCaptureEffect(null);
      }
      captureClearTimerRef.current = null;
    }, nextEffect.durationMs);
  };

  const startVisualFinish = (nextEffect: FinishVisualEffect) => {
    if (finishClearTimerRef.current !== null) window.clearTimeout(finishClearTimerRef.current);
    visualFinishEffectRef.current = nextEffect;
    setVisualFinishEffect(nextEffect);
    finishClearTimerRef.current = window.setTimeout(() => {
      if (visualFinishEffectRef.current?.id === nextEffect.id) {
        visualFinishEffectRef.current = null;
        setVisualFinishEffect(null);
      }
      finishClearTimerRef.current = null;
    }, nextEffect.durationMs);
  };

  useEffect(() => () => {
    if (captureClearTimerRef.current !== null) window.clearTimeout(captureClearTimerRef.current);
    if (captureSoundTimerRef.current !== null) window.clearTimeout(captureSoundTimerRef.current);
    if (finishClearTimerRef.current !== null) window.clearTimeout(finishClearTimerRef.current);
  }, []);

  useEffect(() => {
    if (!movingPieceId) {
      activeMovePieceIdRef.current = '';
      setCaptureDestinationNodeId('');
      return;
    }
    if (activeMovePieceIdRef.current === movingPieceId) return;
    activeMovePieceIdRef.current = movingPieceId;
    const movingPieceBeforeStep = previousPiecesRef.current.find((piece) => piece.id === movingPieceId)
      ?? pieces.find((piece) => piece.id === movingPieceId);
    if (!movingPieceBeforeStep || !roll || roll.steps === 0) {
      setCaptureDestinationNodeId('');
      return;
    }
    const pathNodeIds = getMovePathNodeIdsWithPrevious(
      movingPieceBeforeStep.nodeId,
      roll.steps,
      displayBranchChoice,
      movingPieceBeforeStep.previousNodeId,
    );
    setCaptureDestinationNodeId(pathNodeIds[pathNodeIds.length - 1] ?? movingPieceBeforeStep.nodeId);
  }, [displayBranchChoice, movingPieceId, roll?.name, roll?.steps]);

  useEffect(() => {
    if (!rollAnimation) return;
    const animationId = String(rollAnimation.id);
    if (lastRollAnimationIdRef.current !== animationId) {
      lastRollAnimationIdRef.current = animationId;
      playStoredSoundEffect('roll');
    }

    const resolvedAnimation = rollAnimation as RollAnimation & { result?: YutResult; fallCount?: number; turnOrder?: boolean };
    const rollSoundState = {
      phase: rollAnimation.phase,
      resultName: resolvedAnimation.result?.name,
      fallCount: resolvedAnimation.fallCount,
      timingZone: rollAnimation.timingZone,
      turnOrder: resolvedAnimation.turnOrder,
    };
    const perfectKey = shouldPlayPerfectRollSound(rollSoundState) ? `${animationId}:perfect` : '';
    if (perfectKey && lastPerfectRollKeyRef.current !== perfectKey) {
      lastPerfectRollKeyRef.current = perfectKey;
      window.setTimeout(() => playStoredSoundEffect('perfect'), 120);
    }

    const outcomeEffect = getRollOutcomeSoundEffect(rollSoundState);
    const outcomeKey = outcomeEffect ? `${animationId}:${outcomeEffect}:${resolvedAnimation.result?.name ?? ''}:${resolvedAnimation.fallCount ?? 0}` : '';
    if (outcomeKey && lastRollOutcomeKeyRef.current !== outcomeKey) {
      lastRollOutcomeKeyRef.current = outcomeKey;
      const delayMs = rollAnimation.phase ? 0 : 420;
      window.setTimeout(() => playStoredSoundEffect(outcomeEffect), delayMs);
    }
  }, [rollAnimation]);

  useEffect(() => {
    const previousNodeIds = previousPieceNodeIdsRef.current;
    const movingPiece = movingPieceId ? pieces.find((piece) => piece.id === movingPieceId) : undefined;
    const previousNodeId = movingPiece ? previousNodeIds.get(movingPiece.id) : undefined;
    if (movingPiece && previousNodeId !== undefined && previousNodeId !== movingPiece.nodeId) playStoredSoundEffect('move');
    previousPieceNodeIdsRef.current = new Map(pieces.map((piece) => [piece.id, piece.nodeId]));
  }, [movingPieceId, pieces]);

  useEffect(() => {
    if (!captureEffect?.id) return;
    const captureEffectId = String(captureEffect.id);
    if (lastCaptureEffectIdRef.current === captureEffectId) return;
    lastCaptureEffectIdRef.current = captureEffectId;
    const capturedPiecesStillOnBoard = captureEffect.pieceIds.some((pieceId) => pieces.some((piece) => piece.id === pieceId && piece.started && !piece.finished));
    const sourcePieces = capturedPiecesStillOnBoard ? pieces : previousPiecesRef.current;
    const nextEffect = createCaptureVisualEffect({
      id: captureEffect.id,
      pieceIds: captureEffect.pieceIds,
      pieces: sourcePieces,
      attackerPieceId: movingPieceId || previousMovingPieceIdRef.current,
      getPieceGroupKey: getPieceSideKey,
    });
    if (nextEffect) startVisualCapture(nextEffect, false);
  }, [captureEffect, getPieceSideKey, movingPieceId, pieces]);

  useEffect(() => {
    const previousPieces = previousPiecesRef.current;
    const previousMovingPieceId = previousMovingPieceIdRef.current;
    if (previousPieces.length && !visualFinishEffectRef.current) {
      const finishedPieceIds = inferFinishedPieceIds({ previousPieces, pieces });
      if (finishedPieceIds.length) {
        const nextEffect = createFinishVisualEffect({
          id: Date.now(),
          pieceIds: finishedPieceIds,
          previousPieces,
        });
        if (nextEffect) startVisualFinish(nextEffect);
      }
    }
    if (previousPieces.length && !captureEffect && !trapEffect && !visualCaptureEffectRef.current) {
      const attackerPieceId = movingPieceId || previousMovingPieceId;
      const inferredPieceIds = inferCapturedPieceIds({
        previousPieces,
        pieces,
        attackerPieceId,
        getPieceGroupKey: getPieceSideKey,
      });
      if (inferredPieceIds.length) {
        const nextEffect = createCaptureVisualEffect({
          id: Date.now(),
          pieceIds: inferredPieceIds,
          pieces: previousPieces,
          attackerPieceId,
          getPieceGroupKey: getPieceSideKey,
        });
        if (nextEffect) startVisualCapture(nextEffect, true);
      }
    }
    previousPiecesRef.current = pieces.map((piece) => ({ ...piece }));
    previousMovingPieceIdRef.current = movingPieceId;
  }, [captureEffect, getPieceSideKey, movingPieceId, pieces, trapEffect]);

  useEffect(() => {
    const revealedItemsKey = revealedItems.join('|');
    if (!revealedItemsKey) {
      lastRevealedItemsKeyRef.current = '';
      return;
    }
    if (lastRevealedItemsKeyRef.current === revealedItemsKey) return;
    lastRevealedItemsKeyRef.current = revealedItemsKey;
    playStoredSoundEffect('itemPickup');
  }, [revealedItems]);

  useEffect(() => {
    const nextStackCounts = new Map<string, number>();
    pieces.forEach((piece) => {
      if (!piece.started || piece.finished || !piece.nodeId || piece.nodeId === 'finish') return;
      const stackKey = `${getPieceSideKey(piece)}:${piece.nodeId}`;
      nextStackCounts.set(stackKey, (nextStackCounts.get(stackKey) ?? 0) + 1);
    });

    if (!stackCountsInitializedRef.current) {
      stackCountsInitializedRef.current = true;
      previousStackCountsRef.current = nextStackCounts;
      return;
    }

    const stackedNow = Array.from(nextStackCounts.entries()).some(([stackKey, count]) => count >= 2 && count > (previousStackCountsRef.current.get(stackKey) ?? 0));
    previousStackCountsRef.current = nextStackCounts;
    if (stackedNow) window.setTimeout(() => playStoredSoundEffect('stack'), 120);
  }, [getPieceSideKey, pieces]);

  return <GameScreen>
    <GamePlayersPanel
      title={activeRoomTitle || title}
      maxPlayers={maxPlayers}
      pieceCount={pieceCount}
      itemMode={itemMode}
      stackedRollMode={stackedRollMode}
      seats={activeTurnOrderIntro || turnOrderPhase.active ? seats : playerPanelSeats}
      activeSeatId={displayedActiveGameSeatId}
      playMode={playMode}
      completedSeatIds={completedSeatIds}
      rankingSeatIds={rankingSeatIds}
      spectators={spectators}
      ownedItems={ownedItems}
      localSeatId={localSeatId}
      getPlayerCardName={getPlayerCardName}
      getSeatPieceColor={getSeatPieceColor}
      onOpenEndGameDialog={onOpenEndGameDialog}
    />
    <BoardPanel>
      <WinnerOverlay winner={visualFinishEffect ? '' : winner} winnerText={winnerText} canContinueRace={canContinueRace} onReturnToWaitingRoom={onReturnToWaitingRoom} onExitToLobby={onFinishGame} onContinueRace={onContinueRace} />
      <TurnOrderIntroOverlay activeTurnOrderIntro={activeTurnOrderIntro} localSeatId={localSeatId} turnOrderClock={turnOrderClock} finalHoldMs={finalHoldMs} />
      {activeTurnOrderIntro && !activeTurnOrderIntro.visible && <div className="turn-order-lock" role="status" aria-live="polite">잠시 후 게임 시작!</div>}
      <GoldenYutPicker isOpen={goldenYutPickerOpen} choices={goldenYutChoices} onSelect={onGoldenYutSelect} />
      <TurnIndicator
        color={displayedTurnColor}
        showNeighbors={showBoardTurnNeighbors && !presentationTurn.isFrozen}
        previousText={previousBoardTurnText}
        previousColor={previousBoardTurnColor}
        currentText={displayedTurnText}
        currentRollStack={presentationTurn.isFrozen ? [] : displayedBoardTurnIndicatorRollStack}
        nextText={nextBoardTurnText}
        nextColor={nextBoardTurnColor}
      />
      <BoardMessageStack turnToast={presentationTurn.isFrozen ? null : turnToast} toast={toast} />
      <GameBoardSection
        pieces={pieces}
        boardItems={boardItems}
        selectedPieceId={selectedPieceId}
        activeMovablePiece={activeMovablePiece}
        selectedGroupPieceIds={selectedGroupPieceIds}
        movingPieceId={movingPieceId}
        isMyTurn={displayedIsMyTurn}
        activeSeat={displayedActiveSeat}
        canSeatControlPiece={canSeatControlPiece}
        onSelectPieceId={onSelectPieceId}
        getPieceSideKey={getPieceSideKey}
        revealedItems={revealedItems}
        highlightedNodeId={highlightedNodeId}
        trapNodes={trapNodes}
        shieldedPieceIds={shieldedPieceIds}
        previewNodeIds={presentationTurn.isFrozen ? [] : previewNodeIds}
        branchChoice={branchChoice}
        onBranchChoiceChange={onBranchChoiceChange}
        captureEffect={visualCaptureEffect}
        captureDestinationNodeId={captureDestinationNodeId}
        finishEffect={visualFinishEffect}
        trapEffect={trapEffect}
        fallEffect={fallEffect}
        trapPlacementNodeIds={trapPlacementNodeIds}
        onSelectTrapNode={onSelectTrapNode}
      />
      <RollStage
        rollAnimation={rollAnimation}
        presentationActorId={fallEffect?.seatId ?? ''}
        onPresentationChange={handleRollPresentationChange}
      />
      {pendingTrapPlacement && <div className="trap-placement-banner" role="status"><strong>함정 설치 위치를 선택하세요</strong><span>{trapPlacementSecondsLeft}초 남음 · 설치 중에는 윷을 던질 수 없습니다.</span></div>}
      <GameBoardControls
        roll={roll}
        activeItemPromptTypes={activeItemPromptTypes}
        localSeatId={localSeatId}
        getItemPromptTimeoutMs={getItemPromptTimeoutMs}
        onUseItem={onUseItem}
        onSkipItemPrompt={onSkipItemPrompt}
        showBottomBranchControls={showBottomBranchControls}
        displayBranchChoice={displayBranchChoice}
        onBranchChoiceChange={onBranchChoiceChange}
        canRequestMove={canRequestMove && !presentationTurn.isFrozen && !deferRollDerivedContent}
        activeSeatId={displayedActiveGameSeatId}
        activeSeatTurnText={displayedActiveSeatTurnText}
        getTurnActionTimeoutMs={getTurnActionTimeoutMs}
        turnActionTimeoutMs={turnActionTimeoutMs}
        onMoveSelectedPiece={onMoveSelectedPiece}
        canRollNow={canRollNow && !presentationTurn.isFrozen && !deferRollDerivedContent}
        canRollForTurnOrderNow={canRollForTurnOrderNow}
        canSubmitTurnAction={canSubmitTurnAction && !presentationTurn.isFrozen && !deferRollDerivedContent}
        onRollYut={onRollYut}
        rollResultHolding={rollResultHolding || presentationTurn.isFrozen || deferRollDerivedContent}
        pendingTrapPlacement={pendingTrapPlacement}
        stackedRollMode={stackedRollMode}
        rollStack={displayedRollStack}
        selectedRollStackIndex={selectedRollStackIndex}
        rollStackClosed={rollStackClosed}
        onSelectRollStackIndex={onSelectRollStackIndex}
        onMoveRollStackIndex={onMoveRollStackIndex}
        moveSelectionTimedOut={moveSelectionTimedOut}
        waitingForOnlineTurnOrder={waitingForOnlineTurnOrder}
        hasActiveTurnOrderIntro={hasActiveTurnOrderIntro}
      />
    </BoardPanel>
    <GameLogPanelView
      logs={displayedLogs}
      getLogCardStyle={getLogCardStyle}
      formatStoredLogSequence={formatStoredLogSequence}
      renderLogText={renderLogText}
      onOpenSequenceExportDialog={onOpenSequenceExportDialog}
    />
  </GameScreen>;
}
