import { useEffect, useRef, type ReactNode } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import type { BoardItem, BranchChoice } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import type { CaptureEffect, FallEffect, GameLog, RollAnimation, Seat, ToastMessage, TrapEffect, TrapNode, TurnOrderIntro, TurnOrderPhase } from '../appState';
import { getRollOutcomeSoundEffect, shouldPlayPerfectRollSound } from '../flows/rollSound';
import { BoardPanel, GameScreen } from '../screens/GameScreen';
import { GameLogPanelView, GamePlayersPanel } from '../containers/GamePanels';
import { BoardMessageStack, GoldenYutPicker, RollStage, TurnIndicator, WinnerOverlay } from '../containers/GameBoardOverlays';
import { GameBoardControls } from '../containers/GameBoardControls';
import { GameBoardSection } from '../containers/GameBoardSection';
import { TurnOrderIntroOverlay } from './TurnOrderIntroOverlay';

type GameScreenViewProps = {
  activeItemPromptTypes: ItemType[];
  pendingItemPromptChoiceLabel: string;
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

export function GameScreenView({ activeItemPromptTypes, pendingItemPromptChoiceLabel, activeMovablePiece, activeRoomTitle, activeSeat, activeTurnOrderIntro, boardItems, boardTurnIndicatorColor, boardTurnIndicatorText, boardTurnIndicatorRollStack, branchChoice, canContinueRace, canRequestMove, canRollNow, canRollForTurnOrderNow, canSeatControlPiece, canSubmitTurnAction, captureEffect, fallEffect, displayBranchChoice, finalHoldMs, formatStoredLogSequence, getItemPromptTimeoutMs, getLogCardStyle, getPieceSideKey, getPlayerCardName, getSeatPieceColor, getTurnActionTimeoutMs, goldenYutChoices, goldenYutPickerOpen, hasActiveTurnOrderIntro, highlightedNodeId, isMyTurn, localSeatId, logs, movingPieceId, ownedItems, pendingTrapPlacement, pieces, playMode, maxPlayers, pieceCount, itemMode, stackedRollMode, rollStack, selectedRollStackIndex, rollStackClosed, onSelectRollStackIndex, onMoveRollStackIndex, moveSelectionTimedOut, previewNodeIds, previousBoardTurnText, previousBoardTurnColor, nextBoardTurnText, nextBoardTurnColor, revealedItems, roll, rollAnimation, rollResultHolding, selectedGroupPieceIds, selectedPieceId, shieldedPieceIds, playerPanelSeats, completedSeatIds, rankingSeatIds, seats, showBottomBranchControls, showBoardTurnNeighbors, spectators, title, activeSeatTurnText, toast, trapEffect, trapNodes, trapPlacementNodeIds, trapPlacementSecondsLeft, turnActionTimeoutMs, turnOrderClock, turnOrderPhase, turnToast, waitingForOnlineTurnOrder, winner, winnerText, onBranchChoiceChange, onContinueRace, onFinishGame, onReturnToWaitingRoom, onGoldenYutSelect, onMoveSelectedPiece, onOpenEndGameDialog, onOpenSequenceExportDialog, onRollYut, onSelectPieceId, onSelectTrapNode, onSkipItemPrompt, onUseItem, renderLogText }: GameScreenViewProps) {
  const lastRollAnimationIdRef = useRef('');
  const lastRollOutcomeKeyRef = useRef('');
  const lastPerfectRollKeyRef = useRef('');
  const previousPieceNodeIdsRef = useRef<Map<string, string>>(new Map());
  const lastCaptureEffectIdRef = useRef('');
  const lastRevealedItemsKeyRef = useRef('');
  const stackCountsInitializedRef = useRef(false);
  const previousStackCountsRef = useRef<Map<string, number>>(new Map());
  const activeGameSeatId = activeTurnOrderIntro || turnOrderPhase.active || waitingForOnlineTurnOrder ? undefined : activeSeat?.id;

  useEffect(() => {
    if (!rollAnimation) return;
    const animationId = String(rollAnimation.id);
    if (lastRollAnimationIdRef.current !== animationId) {
      lastRollAnimationIdRef.current = animationId;
      playStoredSoundEffect('roll');
    }

    const rollSoundState = {
      phase: rollAnimation.phase,
      resultName: rollAnimation.result?.name,
      fallCount: rollAnimation.fallCount,
      timingZone: rollAnimation.timingZone,
      turnOrder: rollAnimation.turnOrder,
    };
    const perfectKey = shouldPlayPerfectRollSound(rollSoundState) ? `${animationId}:perfect` : '';
    if (perfectKey && lastPerfectRollKeyRef.current !== perfectKey) {
      lastPerfectRollKeyRef.current = perfectKey;
      window.setTimeout(() => playStoredSoundEffect('perfect'), 120);
    }

    const outcomeEffect = getRollOutcomeSoundEffect(rollSoundState);
    const outcomeKey = outcomeEffect ? `${animationId}:${outcomeEffect}:${rollAnimation.result?.name ?? ''}:${rollAnimation.fallCount ?? 0}` : '';
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
    const captureEffectId = captureEffect?.id ? String(captureEffect.id) : '';
    if (!captureEffectId || lastCaptureEffectIdRef.current === captureEffectId) return;
    lastCaptureEffectIdRef.current = captureEffectId;
    playStoredSoundEffect('capture');
  }, [captureEffect]);

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
      activeSeatId={activeGameSeatId}
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
      <WinnerOverlay winner={winner} winnerText={winnerText} canContinueRace={canContinueRace} onReturnToWaitingRoom={onReturnToWaitingRoom} onExitToLobby={onFinishGame} onContinueRace={onContinueRace} />
      <TurnOrderIntroOverlay activeTurnOrderIntro={activeTurnOrderIntro} localSeatId={localSeatId} turnOrderClock={turnOrderClock} finalHoldMs={finalHoldMs} />
      {activeTurnOrderIntro && !activeTurnOrderIntro.visible && <div className="turn-order-lock" role="status" aria-live="polite">잠시 후 게임 시작!</div>}
      <GoldenYutPicker isOpen={goldenYutPickerOpen} choices={goldenYutChoices} onSelect={onGoldenYutSelect} />
      <TurnIndicator color={boardTurnIndicatorColor} showNeighbors={showBoardTurnNeighbors} previousText={previousBoardTurnText} previousColor={previousBoardTurnColor} currentText={boardTurnIndicatorText} currentRollStack={boardTurnIndicatorRollStack} nextText={nextBoardTurnText} nextColor={nextBoardTurnColor} />
      <BoardMessageStack turnToast={turnToast} toast={toast} />
      <GameBoardSection
        pieces={pieces}
        boardItems={boardItems}
        selectedPieceId={selectedPieceId}
        activeMovablePiece={activeMovablePiece}
        selectedGroupPieceIds={selectedGroupPieceIds}
        movingPieceId={movingPieceId}
        isMyTurn={isMyTurn}
        activeSeat={activeSeat}
        canSeatControlPiece={canSeatControlPiece}
        onSelectPieceId={onSelectPieceId}
        getPieceSideKey={getPieceSideKey}
        revealedItems={revealedItems}
        highlightedNodeId={highlightedNodeId}
        trapNodes={trapNodes}
        shieldedPieceIds={shieldedPieceIds}
        previewNodeIds={previewNodeIds}
        branchChoice={branchChoice}
        onBranchChoiceChange={onBranchChoiceChange}
        captureEffect={captureEffect}
        trapEffect={trapEffect}
        fallEffect={fallEffect}
        trapPlacementNodeIds={trapPlacementNodeIds}
        onSelectTrapNode={onSelectTrapNode}
      />
      <RollStage rollAnimation={rollAnimation} />
      {pendingTrapPlacement && <div className="trap-placement-banner" role="status"><strong>함정 설치 위치를 선택하세요</strong><span>{trapPlacementSecondsLeft}초 남음 · 설치 중에는 윷을 던질 수 없습니다.</span></div>}
      <GameBoardControls
        roll={roll}
        activeItemPromptTypes={activeItemPromptTypes}
        pendingItemPromptChoiceLabel={pendingItemPromptChoiceLabel}
        localSeatId={localSeatId}
        getItemPromptTimeoutMs={getItemPromptTimeoutMs}
        onUseItem={onUseItem}
        onSkipItemPrompt={onSkipItemPrompt}
        showBottomBranchControls={showBottomBranchControls}
        displayBranchChoice={displayBranchChoice}
        onBranchChoiceChange={onBranchChoiceChange}
        canRequestMove={canRequestMove}
        activeSeatId={activeGameSeatId}
        activeSeatTurnText={activeSeatTurnText}
        getTurnActionTimeoutMs={getTurnActionTimeoutMs}
        turnActionTimeoutMs={turnActionTimeoutMs}
        onMoveSelectedPiece={onMoveSelectedPiece}
        canRollNow={canRollNow}
        canRollForTurnOrderNow={canRollForTurnOrderNow}
        canSubmitTurnAction={canSubmitTurnAction}
        onRollYut={onRollYut}
        rollResultHolding={rollResultHolding}
        pendingTrapPlacement={pendingTrapPlacement}
        stackedRollMode={stackedRollMode}
        rollStack={rollStack}
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
      logs={logs}
      getLogCardStyle={getLogCardStyle}
      formatStoredLogSequence={formatStoredLogSequence}
      renderLogText={renderLogText}
      onOpenSequenceExportDialog={onOpenSequenceExportDialog}
    />
  </GameScreen>;
}
