import type { ReactNode } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { ItemType } from '../../features/items/logic/items';
import type { BoardItem, BranchChoice } from '../../game-core/board/board';
import type { YutResult } from '../../game-core/roll';
import type { CaptureEffect, FallEffect, GameLog, RollAnimation, Seat, ToastMessage, TrapEffect, TrapNode, TurnOrderIntro, TurnOrderPhase } from '../appState';
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
  onOpenDiagnosticDialog: () => void;
  onOpenSequenceExportDialog: () => void;
  onRollYut: (timingPositionPercent?: number) => void;
  onSelectPieceId: (pieceId: string) => void;
  onSelectTrapNode: (nodeId: string) => void;
  onSkipItemPrompt: () => void;
  onUseItem: (type: ItemType, actorId?: string, remotePayload?: Record<string, unknown>) => Promise<void>;
  pieces: BoardPiece[];
  renderLogText: (text: string) => ReactNode;
};

export function GameScreenView({ activeItemPromptTypes, activeMovablePiece, activeRoomTitle, activeSeat, activeTurnOrderIntro, boardItems, boardTurnIndicatorColor, boardTurnIndicatorText, boardTurnIndicatorRollStack, branchChoice, canContinueRace, canRequestMove, canRollNow, canSeatControlPiece, canSubmitTurnAction, captureEffect, fallEffect, displayBranchChoice, finalHoldMs, formatStoredLogSequence, getItemPromptTimeoutMs, getLogCardStyle, getPieceSideKey, getPlayerCardName, getSeatPieceColor, getTurnActionTimeoutMs, goldenYutChoices, goldenYutPickerOpen, hasActiveTurnOrderIntro, highlightedNodeId, isMyTurn, localSeatId, logs, movingPieceId, ownedItems, pendingTrapPlacement, pieces, playMode, maxPlayers, pieceCount, itemMode, stackedRollMode, rollStack, selectedRollStackIndex, rollStackClosed, onSelectRollStackIndex, onMoveRollStackIndex, moveSelectionTimedOut, previewNodeIds, previousBoardTurnText, previousBoardTurnColor, nextBoardTurnText, nextBoardTurnColor, revealedItems, roll, rollAnimation, rollResultHolding, selectedGroupPieceIds, selectedPieceId, playerPanelSeats, completedSeatIds, rankingSeatIds, seats, showBottomBranchControls, showBoardTurnNeighbors, spectators, title, activeSeatTurnText, toast, trapEffect, trapNodes, trapPlacementNodeIds, trapPlacementSecondsLeft, turnActionTimeoutMs, turnOrderClock, turnOrderPhase, turnToast, waitingForOnlineTurnOrder, winner, winnerText, onBranchChoiceChange, onContinueRace, onFinishGame, onReturnToWaitingRoom, onGoldenYutSelect, onMoveSelectedPiece, onOpenEndGameDialog, onOpenDiagnosticDialog, onOpenSequenceExportDialog, onRollYut, onSelectPieceId, onSelectTrapNode, onSkipItemPrompt, onUseItem, renderLogText }: GameScreenViewProps) {
  const playerPanelActiveSeatId = activeTurnOrderIntro || turnOrderPhase.active || waitingForOnlineTurnOrder ? undefined : activeSeat?.id;

  return <GameScreen>
    <GamePlayersPanel
      title={activeRoomTitle || title}
      maxPlayers={maxPlayers}
      pieceCount={pieceCount}
      itemMode={itemMode}
      stackedRollMode={stackedRollMode}
      seats={activeTurnOrderIntro || turnOrderPhase.active ? seats : playerPanelSeats}
      activeSeatId={playerPanelActiveSeatId}
      playMode={playMode}
      completedSeatIds={completedSeatIds}
      rankingSeatIds={rankingSeatIds}
      spectators={spectators}
      ownedItems={ownedItems}
      localSeatId={localSeatId}
      getPlayerCardName={getPlayerCardName}
      getSeatPieceColor={getSeatPieceColor}
      onUseItem={onUseItem}
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
        localSeatId={localSeatId}
        getItemPromptTimeoutMs={getItemPromptTimeoutMs}
        onUseItem={onUseItem}
        onSkipItemPrompt={onSkipItemPrompt}
        showBottomBranchControls={showBottomBranchControls}
        displayBranchChoice={displayBranchChoice}
        onBranchChoiceChange={onBranchChoiceChange}
        canRequestMove={canRequestMove}
        activeSeatId={activeSeat?.id}
        activeSeatTurnText={activeSeatTurnText}
        getTurnActionTimeoutMs={getTurnActionTimeoutMs}
        turnActionTimeoutMs={turnActionTimeoutMs}
        onMoveSelectedPiece={onMoveSelectedPiece}
        canRollNow={canRollNow}
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
      onOpenDiagnosticDialog={onOpenDiagnosticDialog}
      onOpenSequenceExportDialog={onOpenSequenceExportDialog}
    />
  </GameScreen>;
}
