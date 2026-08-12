import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import type { BoardPiece } from '../features/game/components/GameBoard';
import type { ItemTiming, ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { DEFAULT_AI_DIFFICULTY, getRuntimeAiDifficultyForSeat, setCurrentAiRollDifficulty } from '../game-core/aiDifficulty';
import { BOARD_NODES, BRANCH_NODE_IDS, getBoardNodeById, getMovePathNodeIds, getMovePathNodeIdsWithPrevious, getAdjacentBoardNodeIds, spawnInitialBoardItems, type BoardItem, type BranchChoice } from '../game-core/board/board';
import { GOLDEN_YUT_CHOICES, chooseAiRollTimingZone, getRollTimingPositionPercent, getRollTimingZone, rollYutResultWithTiming, makeDisplaySticks, rollYutResult, shouldFallForTimingZone, type RollTimingZone, type YutResult, type YutStick } from '../game-core/roll';
import { makeTimeoutActionKey, resolveGoldenYutTimeout, resolveMoveTimeout, resolveRollTimeout } from '../features/room/services/timeoutResolvers';
import { canRoll, canSubmitTurnAction as canSubmitTurnActionFromEngine, getRollActionBlockReasons, getTurnActionBlockReasons } from '../game-core/gameEngine';
import { cancelRoomGameStart, commitAuthoritativeGameAction, completeTurnOrderIntro, createRoom, deleteRoom, getGameSequencesSince, getLatestGameState, getProcessedGameAction, getRoom, initializeGameState, isRoomInGame, joinRoom, requestRoomGameStart, resolveTurnOrderIntro, updateRoomOptions, updateRoomPlayer, type GameAction, type GameSeatSnapshot, type GameSequence, type RoomPlayer, type RoomSummary, type SaveGameStateResult } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { useAppPreferences } from './hooks/useAppPreferences';
import { useRoomCreationController } from './controllers/useRoomCreationController';
import { useRoomEntryController } from './controllers/useRoomEntryController';
import { useStoredRoomRecoveryController } from './controllers/useStoredRoomRecoveryController';
import { useRoomSummarySubscription } from './controllers/useRoomSummarySubscription';
import { useRoomPlayersSubscription } from './controllers/useRoomPlayersSubscription';
import { useWaitingRoomController } from './controllers/useWaitingRoomController';
import { useAuthoritativeGameSyncController } from './controllers/useAuthoritativeGameSyncController';
import { useGameLifecycleController } from './controllers/useGameLifecycleController';
import { useGameStartController } from './controllers/useGameStartController';
import { useItemController } from './controllers/useItemController';
import { useAuthSession } from './hooks/useAuthSession';
import { useGameSyncDebugState } from './hooks/useGameSync';
import {
  getGameConnectionPresentation,
  getGameConnectionSnapshot,
  publishGameConnectionState,
  shouldRecoverGameConnectionOnResume,
  subscribeGameConnectionState,
} from './hooks/gameConnectionState';
import { applySequenceEvent, applySequenceEvents } from './hooks/applySequenceEvent';
import { createSequenceRecoveryWatchdog, shouldDeferSequenceRecovery, type SequenceRecoveryCheckResult, type SequenceRecoveryWatchdogController } from './hooks/sequenceRecoveryWatchdog';
import { useGameStatePersistence } from './hooks/useGameStatePersistence';
import { useGameCoordinatorLease, type ClientGameCoordinatorLease } from './hooks/useGameCoordinatorLease';
import { useDeadlineReached } from './hooks/useDeadlineReached';
import { usePendingRemoteActions } from './hooks/usePendingRemoteActions';
import { useRollPresentationBlocked } from './hooks/useRollPresentationBlocked';
import { usePresenceRecovery } from './hooks/usePresenceRecovery';
import { useRoomPresence } from './hooks/useRoomPresence';
import { LobbyContainer } from './containers/LobbyContainer';
import { WaitingRoomContainer } from './containers/WaitingRoomContainer';
import { AppModals } from './components/AppModals';
import { AppShellHeader } from './components/AppShellHeader';
import { GameScreenView } from './components/GameScreenView';
import { chooseAiAfterMoveItem, chooseAiGoldenYutResult, chooseAiMove, getAiItemValue, shouldAiUseReroll } from './flows/aiFlow';
import { getStartGameBlockMessage } from './flows/gameStartFlow';
import { classifyTurnActionFeedback, shouldClearActionErrorDialog, shouldOpenTurnActionErrorDialog } from './flows/actionFeedback';
import { createGameLogPresentation, isTurnOrderSystemLog } from './flows/gameLogPresentation';
import { getHumanSeatsWaitingForGameEntry, getOnlineGameCoordinatorSeatId, haveAllHumanSeatsEnteredGame } from './flows/onlineGameCoordinator';
import { calculatePieceSelection } from './flows/pieceSelection';
import { resolveEffectiveMoveContext } from './flows/effectiveMoveContext';
import { getMoveActionReadiness, getMoveActionReady, type MoveActionSubmissionOptions } from './flows/moveActionReadiness';
import { commitAcceptedMovePresentation, prepareMovePresentationStart } from './flows/movePresentationStart';
import { preparePendingLocalMoveOwnership, type PendingLocalMoveOwnershipFailure } from './flows/pendingLocalMoveOwnership';
import { localMoveLedger } from './flows/localMoveOwnership';
import { localMovePresentationLifecycle } from './flows/localMovePresentationLifecycle';
import {
  buildAlternatingTeamTurnOrder,
  createTurnOrderIntro,
  formatTurnOrderSummary,
  shuffleSeatsForGame,
} from './flows/turnOrderFlow';
import {
  AI_NAME_BASES,
  AI_NAME_PREFIXES,
  PLAYER_COLORS,
  PLAYER_COLOR_LABELS,
  STORAGE_KEYS,
  TEAM_COLORS,
  createSeats,
  gameSeatSnapshotsFromSeats,
  makeGameStateFingerprint,
  makePieces,
  validateNickname,
  preserveLockedGameSeats,
  seatsFromGameSeatSnapshots,
  seatsWithJoinedPlayer,
  type CaptureEffect,
  type FallEffect,
  type GameLog,
  type ManualSyncResolution,
  type PendingItemPickup,
  type PendingTrapPlacement,
  type PieceCount,
  type PlayMode,
  type RollAnimation,
  type Screen,
  type Seat,
  type SequenceStateSnapshot,
  type StalledTurnSyncResolution,
  type Team,
  type ToastMessage,
  type TrapEffect,
  type TrapNode,
  type TurnOrderIntro,
  type TurnOrderPhase,
} from './appState';
import {
  delay,
  formatStoredLogSequence,
  getEffectiveBranchChoice,
  getMovePreviewNodeIds,
  getTurnOrderStoppedSlotCount,
  normalizeMaxPlayers,
  normalizeRollResultReadyAt,
  withAndParticle,
  withSubjectParticle,
} from './appUtils';
import { isFirebaseConfigured } from '../services/firebase/firebaseApp';
import { playSoundEffect, type SoundEffect } from '../shared/audio/sound';
import { readStorageText } from '../shared/storage/readStorageText';
import { makeBugReportSequenceExport, makeGameDiagnosticState } from './diagnostics/gameDiagnostics';
import {
  TURN_ACTION_TIMEOUT_MS,
  getTurnActionTimeoutMsForCount,
  getTurnRecoveryDeadlineAt,
  incrementTurnActionTimeoutCount,
  normalizeTurnActionTimeoutCount,
} from '../features/room/services/roomTiming';
import {
  AI_AUTHORITATIVE_ACTION_RETRY_DELAY_MS,
  AI_AUTHORITATIVE_ACTION_RETRY_LIMIT,
  AI_MOVE_DELAY_MS,
  ITEM_PROMPT_TIMEOUT_MS,
  ITEM_REPLACE_TIMEOUT_MS,
  AUTO_SINGLE_MOVE_DELAY_MS,
  PENDING_ROLL_EXTRA_SPIN_MS,
  PENDING_ROLL_LANDING_MS,
  PENDING_ROLL_PRIMARY_MS,
  PENDING_ROLL_RESULT_HOLD_MS,
  ROLL_ANIMATION_MS,
  ROLL_STUCK_TIMEOUT_MS,
  SEQUENCE_RECOVERY_INITIAL_DELAY_MS,
  SEQUENCE_RECOVERY_MAX_ATTEMPTS,
  SEQUENCE_RECOVERY_MAX_TOTAL_MS,
  SEQUENCE_RECOVERY_RETRY_DELAYS_MS,
  START_CANCEL_LOCK_MS,
  STALE_PENDING_REMOTE_ACTION_MS,
  START_REQUEST_TIMEOUT_MS,
  STEP_DELAY_MS,
  TOAST_MESSAGE_MS,
  TRAP_EFFECT_MS,
  TURN_DELAY_MS,
  NO_MOVABLE_PIECE_AUTO_PASS_DELAY_MS,
  TURN_ORDER_FINAL_HOLD_MS,
  TURN_ORDER_PRESENCE_FALLBACK_MS,
  TURN_ORDER_ROLL_ANIMATION_MS,
} from './config/gameTimings';
import { getQaInitializeGameStateDelayMs, getQaRequestRoomGameStartDelayMs, getQaRollYutActionDelayMs } from './config/qaDelays';
import { getSequenceRefetchAfter } from './utils/sequenceRefetch';
import { getSeededTurnOrderSeats } from './utils/turnOrderSeed';
import '../styles/globals.css';

export function App() {
  const [message, setMessage] = useState('');
  const handleAuthError = useCallback((nextMessage: string) => setMessage(nextMessage), []);
  const { user, userRef, rememberUser } = useAuthSession(handleAuthError);
  const {
    nickname,
    setNickname,
    nicknameDraft,
    setNicknameDraft,
    title,
    setTitle,
    playMode,
    setPlayMode,
    maxPlayers,
    setMaxPlayers,
    itemMode,
    setItemMode,
    stackedRollMode,
    setStackedRollMode,
    pieceCount,
    setPieceCount,
    soundEnabled,
    setSoundEnabled,
  } = useAppPreferences();
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
  const [endGameDialogOpen, setEndGameDialogOpen] = useState(false);
  const [actionErrorDialog, setActionErrorDialog] = useState('');
  const actionErrorDialogContextRef = useRef({ roomId: '', sequence: 0, turnIndex: 0 });
  const [roomNoticeDialog, setRoomNoticeDialog] = useState<{ title: string; message: string } | null>(null);
  const [lastActionDiagnostic, setLastActionDiagnostic] = useState<{ type: string; message: string; reasons: string[]; createdAt: number } | null>(null);
  const [remoteActionDiagnostics, setRemoteActionDiagnostics] = useState<Array<{ type: string; stage: string; status?: string; message: string; actionKey?: string; createdAt: number; sequence: number; turnIndex: number }>>([]);
  const [diagnosticDialogOpen, setDiagnosticDialogOpen] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [sequenceExportDialogOpen, setSequenceExportDialogOpen] = useState(false);
  const [sequenceExportCopied, setSequenceExportCopied] = useState(false);
  const [sequenceExportText, setSequenceExportText] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [lastManualSyncResolution, setLastManualSyncResolution] = useState<ManualSyncResolution | null>(null);
  const [initialGameStateSaveDiagnostic, setInitialGameStateSaveDiagnostic] = useState<{ status: SaveGameStateResult['status'] | 'pending' | 'error' | ''; turnVersion: number; lastSequence: number; startedAt: number; completedAt: number; source: string; message: string; fingerprint: string } | null>(null);
  const [screen, setScreen] = useState<Screen>('lobby');
  const [activeRoomTitle, setActiveRoomTitle] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [activeRoomHostId, setActiveRoomHostId] = useState('');
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [countdown, setCountdown] = useState(-1);
  const [startRequestVersion, setStartRequestVersion] = useState(0);
  const [startRequestId, setStartRequestId] = useState('');
  const [startCountdownStartsAt, setStartCountdownStartsAt] = useState(0);
  const [startCountdownEndsAt, setStartCountdownEndsAt] = useState(0);
  const [startStatus, setStartStatus] = useState<NonNullable<RoomSummary['startStatus']>>('idle');
  const [startRequestPending, setStartRequestPending] = useState(false);
  const [initialGameEntryPending, setInitialGameEntryPending] = useState(false);
  const [authoritativeGameStateReady, setAuthoritativeGameStateReady] = useState(false);
  const [firebaseLatencySamples, setFirebaseLatencySamples] = useState<number[]>([]);
  const [spectators, setSpectators] = useState<Seat[]>([]);
  const [presenceCleanupEligibility, setPresenceCleanupEligibility] = useState({ roomId: '', eligible: false });
  const [gameCoordinatorLease, setGameCoordinatorLease] = useState<ClientGameCoordinatorLease>({ coordinatorSeatId: '', coordinatorEpoch: 0, coordinatorLeaseExpiresAt: 0 });
  const updateGameCoordinatorLease = useCallback((lease: ClientGameCoordinatorLease) => setGameCoordinatorLease(lease), []);
  const [pendingItemPickup, setPendingItemPickup] = useState<PendingItemPickup | null>(null);
  const [seats, setSeats] = useState<Seat[]>(() => createSeats('플레이어', 'individual', 4));
  const [pieces, setPieces] = useState<BoardPiece[]>(() => makePieces(createSeats('플레이어', 'individual', 4), 4));
  const [gameStartedAt, setGameStartedAt] = useState<number | null>(null);
  const [boardItems, setBoardItems] = useState<BoardItem[]>([]);
  const [ownedItems, setOwnedItems] = useState<Record<string, ItemType[]>>({});
  const [trapNodes, setTrapNodes] = useState<TrapNode[]>([]);
  const [shieldedPieceIds, setShieldedPieceIds] = useState<string[]>([]);
  const [lastMovedPieceIds, setLastMovedPieceIds] = useState<string[]>([]);
  const [lastMovedSeatId, setLastMovedSeatId] = useState('');
  const [revealedItems, setRevealedItems] = useState<ItemType[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState('host-piece-1');
  const [turnIndex, setTurnIndex] = useState(0);
  const turnIndexRef = useRef(0);
  const [turnOrderIds, setTurnOrderIds] = useState<string[]>([]);
  const [initialTurnOrderIds, setInitialTurnOrderIds] = useState<string[]>([]);
  const [completedSeatIds, setCompletedSeatIds] = useState<string[]>([]);
  const [rankingSeatIds, setRankingSeatIds] = useState<string[]>([]);
  const [gameEndMode, setGameEndMode] = useState<'partial_finish' | 'final' | ''>('');
  const [lastFinishedSeatId, setLastFinishedSeatId] = useState('');
  const [authoritativeWinner, setAuthoritativeWinner] = useState('');
  const [continuationRound, setContinuationRound] = useState(0);
  const [roll, setRoll] = useState<YutResult | null>(null);
  const [rollStack, setRollStack] = useState<YutResult[]>([]);
  const [selectedRollStackIndex, setSelectedRollStackIndex] = useState<number | null>(null);
  const [rollStackClosed, setRollStackClosed] = useState(false);
  const [movingPieceId, setMovingPieceId] = useState('');
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [turnToast, setTurnToast] = useState<{ id: number; text: string } | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState('');
  const [branchChoice, setBranchChoice] = useState<BranchChoice>('outer');
  const [turnOrderPhase, setTurnOrderPhase] = useState<TurnOrderPhase>({ active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 });
  const [turnOrderIntro, setTurnOrderIntro] = useState<TurnOrderIntro | null>(null);
  const [waitingForPlayersReady, setWaitingForPlayersReady] = useState(false);
  const [turnDeadlineAt, setTurnDeadlineAt] = useState(0);
  const [turnDeadlineKind, setTurnDeadlineKind] = useState<'roll' | 'move' | 'item_prompt' | 'trap_placement' | ''>('');
  const [turnActionTimeoutCountBySeatId, setTurnActionTimeoutCountBySeatId] = useState<Record<string, number>>({});
  const [autoPlayBySeatId, setAutoPlayBySeatId] = useState<Record<string, boolean>>({});
  const autoPlayBySeatIdRef = useRef<Record<string, boolean>>({});
  const [resumeHumanControlPending, setResumeHumanControlPending] = useState(false);
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const piecesRef = useRef<BoardPiece[]>(pieces);
  const [captureEffect, setCaptureEffect] = useState<CaptureEffect | null>(null);
  const [trapEffect, setTrapEffect] = useState<TrapEffect | null>(null);
  const [fallEffect, setFallEffect] = useState<FallEffect | null>(null);
  const [rollTimingFeedback, setRollTimingFeedback] = useState<RollTimingZone | null>(null);
  const [lastRollTimingZone, setLastRollTimingZone] = useState<RollTimingZone | null>(null);
  const [pendingTrapPlacement, setPendingTrapPlacement] = useState<PendingTrapPlacement | null>(null);
  const [forcedRoll, setForcedRoll] = useState<YutResult | null>(null);
  const [goldenYutPickerOpen, setGoldenYutPickerOpen] = useState(false);
  const [pendingGoldenYutSelection, setPendingGoldenYutSelection] = useState<{ actorId: string; deadline: number } | null>(null);
  const [itemPromptTiming, setItemPromptTiming] = useState<ItemTiming | null>(null);
  const [pendingItemPromptChoice, setPendingItemPromptChoice] = useState<{ actionKey: string; timing: ItemTiming; itemType: ItemType | null } | null>(null);
  const [pendingAfterMoveTurnIndex, setPendingAfterMoveTurnIndex] = useState<number | null>(null);
  const resolvedItemPromptKeysRef = useRef<Set<string>>(new Set());
  const [rollLockUntil, setRollLockUntil] = useState(0);
  const [rollResultReadyAt, setRollResultReadyAt] = useState(0);
  const [rollInProgress, setRollInProgress] = useState(false);
  const [moveInProgress, setMoveInProgress] = useState(false);
  const [turnActionTimeoutPenaltyBySeatId, setTurnActionTimeoutPenaltyBySeatId] = useState<Record<string, number>>({});
  const processingActionIdsRef = useRef<Set<string>>(new Set());
  const completedActionIdsRef = useRef<Set<string>>(new Set());
  const processedClientActionIdsRef = useRef<Set<string>>(new Set());
  const rollInProgressRef = useRef(false);
  const rollInProgressStartedAtRef = useRef(0);
  const rollTimingStartedAtRef = useRef(Date.now());
  const moveInProgressRef = useRef(false);
  function setMoveInProgressState(nextMoveInProgress: boolean) {
    moveInProgressRef.current = nextMoveInProgress;
    setMoveInProgress(nextMoveInProgress);
  }
  const {
    pendingLocalRemoteActionCount,
    pendingLocalRemoteActionsRef,
    rejectedRemoteActionKeysRef,
    pendingLocalRemoteActionMetaRef,
    localClientMutationIdsRef,
    getPendingLocalRemoteActionType,
    addPendingLocalRemoteAction,
    deletePendingLocalRemoteAction,
    acknowledgePendingLocalRemoteAction,
    clearPendingLocalRemoteActions,
  } = usePendingRemoteActions();
  const rollPresentationBlocked = useRollPresentationBlocked();
  const sequenceReplayInProgressRef = useRef(false);
  const queuedSyncedStateRef = useRef<SequenceStateSnapshot | null>(null);
  const currentSequenceStateRef = useRef<SequenceStateSnapshot | null>(null);
  const completingTurnOrderIntroRef = useRef<Set<number>>(new Set());
  const remoteActionRetryTimersRef = useRef<Map<string, number>>(new Map());
  const currentRollRef = useRef<YutResult | null>(null);
  const rollAnimationTimerRef = useRef<number | null>(null);
  const pendingRollAnimationRef = useRef<{ actionKey: string; animationId: number; startedAt: number; resolveTimer: number | null; closeTimer: number | null; timingZone?: RollTimingZone; result?: YutResult; sticks?: YutStick[]; fallCount?: number; animationKey?: string; authoritativeResolved: boolean; preservedLogIds: Set<number>; preservedRollStack: YutResult[]; preservedSelectedRollStackIndex: number | null; preservedRollStackClosed: boolean; phase: 'primary' | 'extra-spin' | 'landing' | 'result-hold' | 'completed' } | null>(null);
  const pendingItemPickupResolverRef = useRef<(() => void) | null>(null);
  const pendingItemPickupRef = useRef<PendingItemPickup | null>(null);
  const shouldAdvanceTurnAfterItemPromptRef = useRef(false);
  const lastSequenceWatchdogAtRef = useRef(0);
  const sequenceRecoveryCheckRef = useRef<() => Promise<SequenceRecoveryCheckResult>>(async () => 'deferred');
  const sequenceRecoveryWatchdogRef = useRef<SequenceRecoveryWatchdogController | null>(null);
  if (!sequenceRecoveryWatchdogRef.current) {
    sequenceRecoveryWatchdogRef.current = createSequenceRecoveryWatchdog({
      runCheck: () => sequenceRecoveryCheckRef.current(),
      scheduler: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (timerId) => window.clearTimeout(timerId),
      },
      initialDelayMs: SEQUENCE_RECOVERY_INITIAL_DELAY_MS,
      retryDelaysMs: SEQUENCE_RECOVERY_RETRY_DELAYS_MS,
      maxAttempts: SEQUENCE_RECOVERY_MAX_ATTEMPTS,
      maxTotalMs: SEQUENCE_RECOVERY_MAX_TOTAL_MS,
      onCheckStarted: () => { lastSequenceWatchdogAtRef.current = Date.now(); },
    });
  }
  const turnRecoveryInFlightRef = useRef<{ roomId: string; token: string } | null>(null);
  const stalledTurnWatchKeyRef = useRef('');
  const stalledTurnStartedAtRef = useRef(0);
  const stalledTurnRecoveryKeyRef = useRef('');
  const enteredGamePresenceKeyRef = useRef('');
  const startedGameRequestVersionsRef = useRef<Set<string>>(new Set());
  const appliedGameStartKeyRef = useRef('');
  const startRequestInFlightRef = useRef(false);
  const pendingStartRequestIdRef = useRef('');
  const timeoutRecoveryKeysRef = useRef<Set<string>>(new Set());

  const getTurnActionTimeoutMs = (seatId = activeSeat?.id ?? '') => activeRoomId
    ? getTurnActionTimeoutMsForCount(turnActionTimeoutCountBySeatId[seatId], TURN_ACTION_TIMEOUT_MS)
    : getTurnActionTimeoutMsForCount(turnActionTimeoutPenaltyBySeatId[seatId], TURN_ACTION_TIMEOUT_MS);
  const getItemPromptTimeoutMs = (seatId = localSeatId) => activeRoomId
    ? getTurnActionTimeoutMsForCount(turnActionTimeoutCountBySeatId[seatId], ITEM_PROMPT_TIMEOUT_MS)
    : getTurnActionTimeoutMsForCount(turnActionTimeoutPenaltyBySeatId[seatId], ITEM_PROMPT_TIMEOUT_MS);
  const markTurnActionTimedOut = (seatId = activeSeat?.id ?? localSeatId) => {
    if (!seatId || activeRoomId) return;
    setTurnActionTimeoutPenaltyBySeatId((current) => {
      const nextCount = incrementTurnActionTimeoutCount(current[seatId]);
      if (nextCount >= 2) setAutoPlayBySeatId((autoPlay) => ({ ...autoPlay, [seatId]: true }));
      return { ...current, [seatId]: nextCount };
    });
  };
  const clearTurnActionTimeoutPenalty = (seatId = activeSeat?.id ?? localSeatId) => {
    if (!seatId || activeRoomId) return;
    setTurnActionTimeoutPenaltyBySeatId((current) => normalizeTurnActionTimeoutCount(current[seatId]) > 0
      ? { ...current, [seatId]: 0 }
      : current);
  };
  const recordFirebaseLatency = (elapsedMs: number) => {
    if (!Number.isFinite(elapsedMs)) return;
    setFirebaseLatencySamples((samples) => [...samples.slice(-9), Math.max(0, Math.round(elapsedMs))]);
  };
  const measureFirebaseLatency = async <T,>(operation: () => Promise<T>) => {
    const startedAt = performance.now();
    try { return await operation(); }
    finally { recordFirebaseLatency(performance.now() - startedAt); }
  };
  const lastAnimatedRollKeyRef = useRef('');
  const lastSyncedRollSoundKeyRef = useRef('');
  const lastSyncedItemEventKeyRef = useRef('');
  const playedSyncedMoveSoundKeysRef = useRef<Set<string>>(new Set());
  const lastSyncedCaptureSoundKeyRef = useRef('');
  const lastSyncedTrapSoundKeyRef = useRef('');
  const lastTurnToastKeyRef = useRef('');
  const applyingSyncedStateRef = useRef(false);
  const lastAppliedStateVersionRef = useRef(0);
  const lastAppliedSequenceRef = useRef(0);
  useEffect(() => {
    if (!actionErrorDialog) return;
    const shouldClear = shouldClearActionErrorDialog({
      dialogOpenedRoomId: actionErrorDialogContextRef.current.roomId,
      currentRoomId: activeRoomId,
      dialogOpenedSequence: actionErrorDialogContextRef.current.sequence,
      currentSequence: lastAppliedSequenceRef.current,
      dialogOpenedTurnIndex: actionErrorDialogContextRef.current.turnIndex,
      currentTurnIndex: turnIndex,
    });
    if (shouldClear) setActionErrorDialog('');
  }, [actionErrorDialog, activeRoomId, pendingLocalRemoteActionCount, turnIndex]);
  const lastWinnerSoundRef = useRef('');
  const lastBranchControlKeyRef = useRef('');
  const aiTurnActionKeyRef = useRef('');
  const liveTurnGuardRef = useRef({ activeSeatId: '', winner: '', movingPieceId: '', pendingTrapPlacement: false, turnOrderActive: false, turnOrderIntro: false });
  const activeRoomIdRef = useRef('');
  const screenRef = useRef<Screen>('lobby');
  const onlineGameCoordinatorSeatIdRef = useRef('');
  const activeRoomHostIdRef = useRef('');
  const logIdRef = useRef(0);
  const spectatorIdsRef = useRef<Set<string>>(new Set());
  const roomPlayerAiStatesRef = useRef<Map<string, { isAI: boolean; isSubstitutedByAI: boolean; isSpectator: boolean; nickname: string }>>(new Map());
  const roomHostClaimKeyRef = useRef('');
  const missingRoomPlayerTimerRef = useRef<number | null>(null);
  const startRequestVersionRef = useRef(0);
  const startRequestIdRef = useRef('');
  const startStatusRef = useRef<NonNullable<RoomSummary['startStatus']>>('idle');
  const confirmedRoomPlayerRef = useRef(false);
  const leavingRoomRef = useRef(false);
  const hostingRoomUserIdRef = useRef('');

  const currentUser = userRef.current ?? user;
  const currentUserId = currentUser?.uid ?? '';
  const rooms = useRooms({ enabled: screen === 'lobby' && Boolean(currentUser) });
  const gameConnection = useSyncExternalStore(subscribeGameConnectionState, getGameConnectionSnapshot, getGameConnectionSnapshot);
  const gameConnectionPresentation = getGameConnectionPresentation(gameConnection);
  const showGameConnection = Boolean(activeRoomId && screen === 'game' && gameConnection.roomId === activeRoomId);
  const serverStatus = !isFirebaseConfigured
    ? '연결 정보 확인 필요'
    : showGameConnection
      ? gameConnectionPresentation.label
      : currentUser ? '온라인' : '연결 중';
  const serverStatusTone = !isFirebaseConfigured
    ? 'offline'
    : showGameConnection
      ? gameConnectionPresentation.tone
      : currentUser ? 'online' : 'pending';
  const displaySeats = useMemo(() => screen === 'game' ? seats.map((seat) => ({ ...seat, isHost: false })) : seats, [screen, seats]);
  const playableSeats = useMemo(() => displaySeats.filter((seat) => !seat.isEmpty), [displaySeats]);
  const syncedGameSeats = useMemo(() => gameSeatSnapshotsFromSeats(playableSeats), [playableSeats]);
  const teamCounts = useMemo(() => playableSeats.reduce<Record<Team, number>>((acc, seat) => ({ ...acc, [seat.team]: acc[seat.team] + 1 }), { 청팀: 0, 홍팀: 0 }), [playableSeats]);
  const teamBalanced = playMode === 'individual' || (maxPlayers === 4 && teamCounts.청팀 === 2 && teamCounts.홍팀 === 2);
  const turnSeats = useMemo(() => {
    if (!turnOrderIds.length) return playableSeats;
    const orderedSeats = turnOrderIds.map((seatId) => playableSeats.find((seat) => seat.id === seatId)).filter((seat): seat is Seat => Boolean(seat));
    return orderedSeats.length ? orderedSeats : playableSeats;
  }, [playableSeats, turnOrderIds]);
  const playerPanelSeats = useMemo(() => {
    const panelOrderIds = initialTurnOrderIds.length ? initialTurnOrderIds : turnOrderIds;
    if (!panelOrderIds.length) return playableSeats;
    const orderedSeats = panelOrderIds.map((seatId) => playableSeats.find((seat) => seat.id === seatId)).filter((seat): seat is Seat => Boolean(seat));
    const remainingSeats = playableSeats.filter((seat) => !panelOrderIds.includes(seat.id));
    return orderedSeats.length ? [...orderedSeats, ...remainingSeats] : playableSeats;
  }, [initialTurnOrderIds, playableSeats, turnOrderIds]);
  const activeSeat = turnSeats[turnIndex % turnSeats.length];
  autoPlayBySeatIdRef.current = autoPlayBySeatId;
  const activeSeatAutoPlay = Boolean(activeSeat && autoPlayBySeatId[activeSeat.id]);
  useEffect(() => {
    setCurrentAiRollDifficulty(activeSeat?.isAI || activeSeat?.isSubstitutedByAI || activeSeatAutoPlay
      ? getRuntimeAiDifficultyForSeat(activeSeat.id, activeSeat)
      : DEFAULT_AI_DIFFICULTY);
  }, [activeSeat?.id, activeSeat?.isAI, activeSeat?.isSubstitutedByAI, activeSeatAutoPlay]);
  const waitingRoomHostSeatId = (!activeRoomId || screen === 'waitingRoom') ? playableSeats.find((seat) => seat.isHost)?.id ?? (activeRoomHostId || 'host') : '';
  const localSeatId = activeRoomId ? currentUserId : waitingRoomHostSeatId;
  const isSpectator = Boolean(activeRoomId && currentUserId && spectators.some((spectator) => spectator.id === currentUserId));
  const hasWaitingRoomHostAuthority = Boolean(screen === 'waitingRoom' && currentUserId && (activeRoomHostId === currentUserId || waitingRoomHostSeatId === currentUserId));
  const isWaitingRoomHost = Boolean(screen === 'waitingRoom' && isRoomHost);
  const onlineGameRole = !activeRoomId ? 'offline' : isSpectator ? 'spectator' : hasWaitingRoomHostAuthority ? 'waiting-room-host' : 'player';
  const isRoomManager = hasWaitingRoomHostAuthority || isWaitingRoomHost;
  const isOnlinePlayer = onlineGameRole === 'player';
  const fallbackOnlineGameCoordinatorSeatId = getOnlineGameCoordinatorSeatId(playableSeats, onlineGameCoordinatorSeatIdRef.current);
  const coordinatorLease = useGameCoordinatorLease({
    activeRoomId,
    screen,
    candidateSeatId: localSeatId,
    candidateSeatIndex: Math.max(0, playableSeats.findIndex((seat) => seat.id === localSeatId)),
    eligible: Boolean(activeRoomId && isOnlinePlayer && localSeatId),
    gameSeats: syncedGameSeats,
    lease: gameCoordinatorLease,
    onLeaseChange: updateGameCoordinatorLease,
  });
  const onlineGameCoordinatorSeatId = coordinatorLease.coordinatorSeatId || fallbackOnlineGameCoordinatorSeatId;
  const coordinatorEpoch = coordinatorLease.coordinatorEpoch;
  onlineGameCoordinatorSeatIdRef.current = onlineGameCoordinatorSeatId;
  const isInitialGameCoordinator = !activeRoomId || Boolean(!isSpectator && localSeatId && localSeatId === fallbackOnlineGameCoordinatorSeatId);
  const canCoordinateOnlineGame = !activeRoomId || coordinatorLease.canCoordinate;
  const coordinatorLeasePayload = { coordinatorSeatId: onlineGameCoordinatorSeatId, coordinatorEpoch };
  const canOwnRoomPresenceCleanup = Boolean(activeRoomId && presenceCleanupEligibility.roomId === activeRoomId && presenceCleanupEligibility.eligible);
  const canResolveInitialOnlineTurnOrder = canCoordinateOnlineGame;
  const canCompleteInitialOnlineTurnOrderIntro = canCoordinateOnlineGame;
  const canManageRoom = isRoomManager;
  const {
    pendingAiSeatCount,
    pendingAiSeatIdsRef,
    addPendingAiSeat,
    clearPendingAiSeat,
    toggleMyReady,
    leaveRoom,
    changeWaitingOptions,
    markPlayerAsAI,
    cancelAISeat,
    kickWaitingPlayer,
    changeTeam,
  } = useWaitingRoomController({
    activeRoomId, localSeatId, screen, nickname, playMode, maxPlayers, itemMode, stackedRollMode, pieceCount, seats, canManageRoom, isRoomManager,
    activeRoomIdRef, leavingRoomRef, confirmedRoomPlayerRef, hostingRoomUserIdRef, addLog, setSeats, setMessage, setScreen, setActiveRoomId, setActiveRoomTitle, setActiveRoomHostId, setIsRoomHost, setCountdown, setTurnOrderIds, setGameStartedAt, setPlayMode, setMaxPlayers, setItemMode, setStackedRollMode, setPieceCount,
  });

  const allReady = pendingAiSeatCount === 0 && seats.every((seat) => !seat.isEmpty && (seat.ready || seat.isAI)) && teamBalanced;
  const gameExitDescription = activeRoomId ? '현재 방에서 나가 로비로 이동합니다. 모든 사람 플레이어가 나가면 방이 종료됩니다.' : 'AI가 대신 플레이하게 됩니다.';
  const localSeatAutoPlay = Boolean(localSeatId && autoPlayBySeatId[localSeatId]);
  const isMyTurn = activeSeat?.id === localSeatId && !activeSeat.isAI && !activeSeatAutoPlay && !isSpectator;
  const getSeatById = (seatId: string) => playableSeats.find((seat) => seat.id === seatId);
  const getSeatColorIndex = (seat: Seat | undefined) => Math.max(0, Number(seat?.label.replace('P', '')) - 1);
  const getSeatPieceColor = (seat: Seat | undefined) => PLAYER_COLORS[getSeatColorIndex(seat)] ?? '#2a1e17';
  const getSeatPieceColorLabel = (seat: Seat | undefined) => PLAYER_COLOR_LABELS[getSeatColorIndex(seat)] ?? seat?.color ?? '검정';
  const isSameSide = (a: Seat | undefined, b: Seat | undefined) => Boolean(a && b && (playMode === 'team' ? a.team === b.team : a.id === b.id));
  const getPieceSideKey = (piece: BoardPiece) => playMode === 'team' ? getSeatById(piece.ownerId)?.team ?? piece.ownerId : piece.ownerId;
  const canSeatControlPiece = (seat: Seat | undefined, piece: BoardPiece | undefined) => Boolean(seat && piece && isSameSide(getSeatById(piece.ownerId), seat));
  const selectedPiece = useMemo(() => pieces.find((piece) => piece.id === selectedPieceId), [pieces, selectedPieceId]);
  const trapPlacementNodeIds = pendingTrapPlacement?.nodeIds ?? [];
  const selectedBranchControlKey = selectedPiece && roll && selectedPiece.started && BRANCH_NODE_IDS.includes(selectedPiece.nodeId as typeof BRANCH_NODE_IDS[number]) ? `${selectedPiece.id}:${selectedPiece.nodeId}:${roll.name}:${roll.steps}` : '';
  const displayBranchChoice: BranchChoice = selectedBranchControlKey && lastBranchControlKeyRef.current !== selectedBranchControlKey ? 'shortcut' : branchChoice;
  const derivedWinner = useMemo(() => {
    const activeGameSeats = turnSeats.length ? turnSeats : playableSeats;
    if (!activeGameSeats.length || !pieces.length) return '';

    if (playMode === 'team') {
      const finishedTeam = (['청팀', '홍팀'] as Team[]).find((team) => {
        if (!activeGameSeats.some((seat) => seat.team === team)) return false;
        const teamPieces = pieces.filter((piece) => getSeatById(piece.ownerId)?.team === team);
        return teamPieces.length >= pieceCount && teamPieces.every((piece) => piece.finished);
      });
      return finishedTeam ? `${finishedTeam} 승리` : '';
    }

    const finishedSeat = activeGameSeats.find((seat) => {
      const seatPieces = pieces.filter((piece) => piece.ownerId === seat.id);
      return seatPieces.length >= pieceCount && seatPieces.every((piece) => piece.finished);
    });
    return finishedSeat ? `${getSeatDisplayName(finishedSeat)} 승리` : '';
  }, [getSeatById, pieceCount, pieces, playMode, playableSeats, turnSeats]);
  const winner = authoritativeWinner || derivedWinner;

  const winnerSeat = useMemo(() => {
    return playableSeats.find((seat) => winner.startsWith(`${seat.label}-${seat.name}`) || winner.startsWith(getSeatDisplayName(seat)));
  }, [playableSeats, winner]);
  const winnerColorText = winnerSeat ? (winner.startsWith(`${winnerSeat.label}-${winnerSeat.name}`) ? `${winnerSeat.label}-${winnerSeat.name}` : getSeatDisplayName(winnerSeat)) : '';
  const winnerSuffixText = winnerColorText && winner.startsWith(winnerColorText) ? winner.slice(winnerColorText.length) : '';
  const renderWinnerText = (withGameEndSuffix = false) => winnerSeat && winnerColorText
    ? <><span className="winner-player-label" style={{ color: getSeatPieceColor(winnerSeat) }}>{getSeatDisplayName(winnerSeat)}</span>{winnerSuffixText}{withGameEndSuffix ? ' · 게임 종료' : ''}</>
    : `${winner}${withGameEndSuffix ? ' · 게임 종료' : ''}`;
  const derivedCompletedSeatIds = useMemo(() => playableSeats
    .filter((seat) => {
      const seatPieces = pieces.filter((piece) => piece.ownerId === seat.id);
      return seatPieces.length >= pieceCount && seatPieces.every((piece) => piece.finished);
    })
    .map((seat) => seat.id), [pieceCount, pieces, playableSeats]);
  const raceBaseSeatIds = initialTurnOrderIds.length ? initialTurnOrderIds : turnOrderIds;
  const unfinishedRaceSeatIds = raceBaseSeatIds.filter((seatId) => !derivedCompletedSeatIds.includes(seatId));
  const derivedPartialFinish = Boolean(winner && playMode === 'individual' && raceBaseSeatIds.length >= 3 && unfinishedRaceSeatIds.length >= 2);
  const canShowContinueRaceButton = Boolean(activeRoomId && playMode === 'individual' && (gameEndMode === 'partial_finish' || derivedPartialFinish) && unfinishedRaceSeatIds.length >= 2);
  const effectiveMoveContext = useMemo(() => resolveEffectiveMoveContext({ stackedRollMode, roll, rollStack, rollStackClosed, selectedRollStackIndex }), [roll, rollStack, rollStackClosed, selectedRollStackIndex, stackedRollMode]);
  const stackedRollSelectedResult = effectiveMoveContext.fromStack ? effectiveMoveContext.roll : null;
  const selectedMoveSteps = effectiveMoveContext.steps;
  const makeItemPromptKey = (timing: ItemTiming, promptTurnIndex = turnIndex, promptRollStackIndex = selectedRollStackIndex, promptSequence = lastAppliedSequenceRef.current) => `${promptSequence}:${promptTurnIndex}:${promptRollStackIndex ?? 'none'}:${timing}`;
  const markItemPromptResolved = (timing: ItemTiming | null, promptRollStackIndex = selectedRollStackIndex) => {
    if (!timing) return;
    resolvedItemPromptKeysRef.current.add(makeItemPromptKey(timing, turnIndex, promptRollStackIndex));
  };

  const stalledTurnRollStackIndex = useMemo(() => {
    if (!stackedRollMode || !roll || rollStack.length === 0) return null;
    if (typeof selectedRollStackIndex === 'number') {
      const selectedStackRoll = rollStack[selectedRollStackIndex];
      if (selectedStackRoll && selectedStackRoll.name === roll.name && selectedStackRoll.steps === roll.steps) return selectedRollStackIndex;
    }
    const matchingIndexes = rollStack
      .map((stackRoll, index) => stackRoll.name === roll.name && stackRoll.steps === roll.steps ? index : -1)
      .filter((index) => index >= 0);
    return matchingIndexes.length === 1 ? matchingIndexes[0] : null;
  }, [roll, rollStack, selectedRollStackIndex, stackedRollMode]);
  const stalledTurnRollStackAmbiguous = Boolean(stackedRollMode && roll && rollStack.length > 0 && stalledTurnRollStackIndex === null);
  const rollLockExpired = useDeadlineReached(rollLockUntil);
  const isRollLocked = Boolean(rollLockUntil > Date.now() && !rollLockExpired);
  const effectiveRollResultReadyAt = normalizeRollResultReadyAt(rollResultReadyAt);
  const rollResultHolding = effectiveRollResultReadyAt > Date.now();
  const activeTurnOrderIntro = turnOrderIntro && turnOrderIntro.readyAt > Date.now() ? turnOrderIntro : null;
  const waitingForOnlineTurnOrder = Boolean(screen === 'game' && activeRoomId && !turnOrderIds.length && !turnOrderPhase.active && !activeTurnOrderIntro);
  const trapPlacementActive = Boolean(pendingTrapPlacement);
  const {
    coordinatorStateSaveKey,
    setCoordinatorStateSaveKey,
    coordinatorStateSaveRetryTick,
    pendingSequenceMetaRef,
    lastSavedStateFingerprintRef,
    savingStateFingerprintRef,
  } = useGameStatePersistence({
    activeRoomId,
    screen,
    canCoordinateOnlineGame,
    coordinatorSeatId: onlineGameCoordinatorSeatId,
    coordinatorEpoch,
    applyingSyncedStateRef,
    moveInProgressRef,
    movingPieceId,
    pieces,
    turnIndex,
    turnOrderIds,
    initialTurnOrderIds,
    completedSeatIds,
    rankingSeatIds,
    gameEndMode,
    lastFinishedSeatId,
    continuationRound,
    roll,
    rollStack,
    selectedRollStackIndex,
    rollStackClosed,
    boardItems,
    ownedItems,
    trapNodes,
    shieldedPieceIds,
    winner,
    gameStartedAt,
    turnOrderIntro,
    pendingTrapPlacement,
    pendingGoldenYutSelection,
    itemPromptTiming,
    pendingAfterMoveTurnIndex,
    rollLockUntil,
    lastMovedPieceIds,
    lastMovedSeatId,
    effectiveRollResultReadyAt,
    turnOrderPhase,
    waitingForPlayersReady,
    turnDeadlineAt,
    turnDeadlineKind,
    turnActionTimeoutCountBySeatId,
    autoPlayBySeatId,
    startRequestVersion,
    startRequestId,
    gameSeats: syncedGameSeats,
    localSeatId,
    activeSeat,
    logs,
    captureEffect,
    trapEffect,
    fallEffect,
    lastRollTimingZone,
    lastAppliedSequenceRef,
    lastAppliedStateVersionRef,
    measureFirebaseLatency,
    onSequenceMismatch: () => syncLatestAuthoritativeState('sequence mismatch가 발생해 최신 authoritative snapshot을 즉시 다시 적용합니다.'),
  });
  const hasAuthoritativeSequence = lastAppliedSequenceRef.current > 0 || lastAppliedStateVersionRef.current > 0;
  const onlineAuthoritativeGameStatePending = Boolean(activeRoomId && screen === 'game' && !authoritativeGameStateReady && !hasAuthoritativeSequence);
  const hasPendingGameStateSave = Boolean(activeRoomId && screen === 'game' && (onlineAuthoritativeGameStatePending || (canCoordinateOnlineGame && coordinatorStateSaveKey)));
  const pendingBlockingRemoteActionCount = Array.from(pendingLocalRemoteActionMetaRef.current.values())
    .filter((meta) => !(meta.type === 'use_item' && meta.optimisticApplied)).length;
  const shouldWaitForAuthoritativeTurnSync = Boolean(activeRoomId && screen === 'game' && pendingBlockingRemoteActionCount > 0 && !isMyTurn);
  const effectivePendingLocalRemoteActionCount = shouldWaitForAuthoritativeTurnSync ? pendingBlockingRemoteActionCount : 0;
  const activeItemPromptTypes = itemPromptTiming && !trapPlacementActive && !localSeatAutoPlay ? getUsableHostItems(itemPromptTiming) : [];
  const hasPendingUseItemActionFor = (actorId = localSeatId) => Array.from(pendingLocalRemoteActionMetaRef.current.values()).some((meta) => meta.type === 'use_item' && meta.actorId === actorId && meta.createdTurnIndex === turnIndex);
  const turnActionGuardInput = {
    activeSeatId: activeSeat?.id,
    actorId: localSeatId,
    isActorAI: Boolean(activeSeat?.isAI || activeSeatAutoPlay),
    isSpectator,
    winner,
    waitingForTurnOrder: waitingForOnlineTurnOrder,
    turnOrderPhaseActive: turnOrderPhase.active,
    turnOrderIntroActive: Boolean(activeTurnOrderIntro),
    movingPieceId,
    pendingTrapPlacement: trapPlacementActive,
    pendingItemPrompt: Boolean(pendingItemPickup) || activeItemPromptTypes.length > 0,
    pendingGameStateSave: hasPendingGameStateSave,
    pendingLocalRemoteActionCount: effectivePendingLocalRemoteActionCount,
    processingActionCount: processingActionIdsRef.current.size,
  };
  const rollActionGuardInput = {
    ...turnActionGuardInput,
    pendingLocalRemoteActionCount: activeRoomId ? pendingBlockingRemoteActionCount : effectivePendingLocalRemoteActionCount,
    roll: stackedRollMode && rollStack.length > 0 && !rollStackClosed ? null : roll,
    rollLocked: isRollLocked,
    remoteActionClient: false,
    rollInProgress,
  };
  const turnActionBlockReasons = useMemo(() => getTurnActionBlockReasons(turnActionGuardInput), [activeSeat?.id, activeSeat?.isAI, activeSeatAutoPlay, activeItemPromptTypes.length, activeTurnOrderIntro, hasPendingGameStateSave, isSpectator, localSeatId, movingPieceId, pendingItemPickup, effectivePendingLocalRemoteActionCount, trapPlacementActive, turnOrderPhase.active, waitingForOnlineTurnOrder, winner]);
  const canSubmitTurnAction = canSubmitTurnActionFromEngine(turnActionGuardInput);
  const pieceSelection = useMemo(() => calculatePieceSelection({
    pieces,
    selectedPieceId,
    hasMoveRoll: Boolean(roll || stackedRollSelectedResult),
    isLocalTurn: Boolean(activeSeat && isMyTurn),
    moveSteps: selectedMoveSteps,
    canControlPiece: (piece) => canSeatControlPiece(activeSeat, piece),
    isSameSidePiece: (piece, selected) => isSameSide(getSeatById(piece.ownerId), getSeatById(selected.ownerId)),
  }), [activeSeat, getSeatById, isMyTurn, isSameSide, pieces, roll, selectedMoveSteps, selectedPieceId, stackedRollSelectedResult]);
  const selectedGroupPieceIds = pieceSelection.selectedGroupPieceIds;
  const selectedPieceCanMove = pieceSelection.selectedPieceCanMove;
  const activeSeatPiecesOnBoard = useMemo(() => activeSeat
    ? pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished)
    : false, [activeSeat, pieces]);
  const fallbackMovablePiece = selectedPieceCanMove ? undefined : pieceSelection.pieceToMove;
  const activeMovablePiece = pieceSelection.pieceToMove;
  const canMoveSelectedPiece = Boolean(activeMovablePiece);
  const noMovableBackDoRoll = Boolean((roll || stackedRollSelectedResult) && activeSeat && isMyTurn && selectedMoveSteps < 0
    && !pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && piece.started));
  const hasPendingCurrentTurnAction = (type: GameAction['type'], actorId = activeSeat?.id ?? '') => Array.from(pendingLocalRemoteActionMetaRef.current.values()).some((meta) => meta.type === type && meta.actorId === actorId && meta.createdTurnIndex === turnIndex);
  const hasPendingOnlineMoveRequest = Boolean(activeRoomId && Array.from(pendingLocalRemoteActionMetaRef.current.values()).some((meta) => meta.type === 'move_piece'));
  const moveActionReadiness = getMoveActionReadiness({
    canSubmitTurnAction,
    rollPresentationBlocked,
    hasPendingMoveAction: hasPendingOnlineMoveRequest,
    hasValidMoveSelection: Boolean((roll || stackedRollSelectedResult) && (canMoveSelectedPiece || noMovableBackDoRoll)),
    rollResultHolding,
    rollAnimationActive: Boolean(rollAnimation),
    moveInProgress,
    movingPieceActive: Boolean(movingPieceId),
    isOnlineMode: Boolean(activeRoomId),
    turnDeadlineAt,
    turnDeadlineKind,
  });
  const canRequestMove = moveActionReadiness.actionReady;
  const previewNodeIds = useMemo(() => canRequestMove && canSeatControlPiece(activeSeat, selectedPiece) ? getMovePreviewNodeIds(selectedPiece, effectiveMoveContext.roll, displayBranchChoice) : [], [activeSeat, canRequestMove, displayBranchChoice, effectiveMoveContext.roll, selectedPiece]);
  const canUseMoveButton = Boolean(canRequestMove && canMoveSelectedPiece);
  const rollActionBlockReasons = useMemo(() => getRollActionBlockReasons(rollActionGuardInput), [activeRoomId, activeSeat?.id, activeSeat?.isAI, activeSeatAutoPlay, activeItemPromptTypes.length, activeTurnOrderIntro, hasPendingGameStateSave, isRollLocked, isSpectator, localSeatId, movingPieceId, pendingItemPickup, effectivePendingLocalRemoteActionCount, pendingLocalRemoteActionCount, roll, rollInProgress, trapPlacementActive, turnOrderPhase.active, waitingForOnlineTurnOrder, winner, stackedRollMode, rollStack.length, rollStackClosed]);
  const canRollNow = canRoll(rollActionGuardInput) && !rollAnimation;
  const stalledTurnMovablePieces = useMemo(() => {
    const stalledRoll = effectiveMoveContext.roll;
    if (!stalledRoll || !activeSeat) return [];
    const steps = stalledRoll.steps;
    return pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (steps >= 0 || piece.started));
  }, [activeSeat, effectiveMoveContext.roll, pieces]);
  const stalledTurnFallbackPiece = useMemo(() => {
    if (!roll || !activeSeat || !stalledTurnMovablePieces.length) return undefined;
    const hasPieceOnBoard = pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished);
    return hasPieceOnBoard ? stalledTurnMovablePieces[0] : [...stalledTurnMovablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
  }, [activeSeat, pieces, roll, stalledTurnMovablePieces]);
  const stalledTurnNeedsBranchChoice = Boolean(stalledTurnFallbackPiece && roll && roll.steps > 0 && stalledTurnFallbackPiece.started && BRANCH_NODE_IDS.includes(stalledTurnFallbackPiece.nodeId as typeof BRANCH_NODE_IDS[number]));
  const stalledTurnWatchKey = activeRoomId && screen === 'game' && !pendingItemPickup && roll && activeSeat
    ? `${activeRoomId}:${lastAppliedSequenceRef.current}:${turnIndex}:${activeSeat.id}:${roll.name}:${roll.steps}:stack:${stalledTurnRollStackIndex ?? 'none'}:${rollStack.map((stackRoll) => `${stackRoll.name}:${stackRoll.steps}`).join('|')}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`
    : '';
  const stalledTurnAgeMs = stalledTurnWatchKey && stalledTurnStartedAtRef.current ? Math.max(0, Date.now() - stalledTurnStartedAtRef.current) : 0;
  const getCurrentStalledTurnSyncAgeMs = () => {
    if (!stalledTurnWatchKey) return 0;
    if (turnDeadlineKind === 'move' && turnDeadlineAt) return Math.max(0, Date.now() - getTurnRecoveryDeadlineAt(turnDeadlineAt) + TURN_ACTION_TIMEOUT_MS);
    const watchAgeMs = stalledTurnStartedAtRef.current ? Math.max(0, Date.now() - stalledTurnStartedAtRef.current) : 0;
    const readyAgeMs = effectiveRollResultReadyAt ? Math.max(0, Date.now() - effectiveRollResultReadyAt) : 0;
    return Math.max(watchAgeMs, readyAgeMs);
  };
  const stalledTurnSyncAgeMs = getCurrentStalledTurnSyncAgeMs();
  const stalledTurnDetected = Boolean(
    stalledTurnWatchKey
    && isOnlinePlayer
    && !winner
    && !rollResultHolding
    && !rollAnimation
    && !movingPieceId
    && !moveInProgress
    && !pendingItemPickup
    && !pendingTrapPlacement
    && stalledTurnMovablePieces.length > 0
    && stalledTurnSyncAgeMs >= TURN_ACTION_TIMEOUT_MS,
  );
  const stalledTurnReason = stalledTurnDetected
    ? stalledTurnNeedsBranchChoice
      ? 'branch-choice-required'
      : canRequestMove
        ? 'local-turn-awaiting-move'
        : 'remote-turn-move-not-completed'
    : '';
  const visibleBoardTurnSeat = activeSeat && !waitingForOnlineTurnOrder && !turnOrderPhase.active && !activeTurnOrderIntro ? activeSeat : undefined;
  const visibleBoardTurnIndex = visibleBoardTurnSeat ? turnSeats.findIndex((seat) => seat.id === visibleBoardTurnSeat.id) : -1;
  const previousBoardTurnSeat = visibleBoardTurnIndex >= 0 && turnSeats.length > 1 ? turnSeats[(visibleBoardTurnIndex - 1 + turnSeats.length) % turnSeats.length] : undefined;
  const nextBoardTurnSeat = visibleBoardTurnIndex >= 0 && turnSeats.length > 1 ? turnSeats[(visibleBoardTurnIndex + 1) % turnSeats.length] : undefined;
  const formatTurnNeighborText = (seat: Seat | undefined) => seat ? getSeatDisplayName(seat) : '';
  const previousBoardTurnText = formatTurnNeighborText(previousBoardTurnSeat);
  const nextBoardTurnText = formatTurnNeighborText(nextBoardTurnSeat);
  const getBoardTurnSeatColor = (seat: Seat | undefined) => seat ? (playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat)) : undefined;
  const previousBoardTurnColor = getBoardTurnSeatColor(previousBoardTurnSeat);
  const nextBoardTurnColor = getBoardTurnSeatColor(nextBoardTurnSeat);
  const hasCompleteBoardTurnNames = Boolean(visibleBoardTurnSeat?.name.trim() && previousBoardTurnSeat?.name.trim() && nextBoardTurnSeat?.name.trim());
  const shouldShowBoardTurnNeighbors = Boolean(previousBoardTurnText && nextBoardTurnText && hasCompleteBoardTurnNames);
  const boardTurnIndicatorText = winner ? renderWinnerText(true) : visibleBoardTurnSeat ? `${getSeatDisplayName(visibleBoardTurnSeat)} 턴` : '';
  const shouldHidePendingRollResultState = rollAnimation?.phase === 'primary' || rollAnimation?.phase === 'extra-spin' || rollAnimation?.phase === 'landing';
  const displayedRollStack = shouldHidePendingRollResultState ? pendingRollAnimationRef.current?.preservedRollStack ?? rollStack : rollStack;
  const displayedSelectedRollStackIndex = shouldHidePendingRollResultState ? pendingRollAnimationRef.current?.preservedSelectedRollStackIndex ?? selectedRollStackIndex : selectedRollStackIndex;
  const displayedRollStackClosed = shouldHidePendingRollResultState ? pendingRollAnimationRef.current?.preservedRollStackClosed ?? rollStackClosed : rollStackClosed;
  const boardTurnIndicatorRollStack = !winner && visibleBoardTurnSeat && stackedRollMode ? displayedRollStack : [];
  const boardTurnIndicatorColor = winner ? '#1f1a17' : visibleBoardTurnSeat ? (playMode === 'team' ? TEAM_COLORS[visibleBoardTurnSeat.team] : getSeatPieceColor(visibleBoardTurnSeat)) : undefined;
  const moveActionBlockReasons = useMemo(() => [
    ...turnActionBlockReasons,
    rollPresentationBlocked ? 'roll-presentation-active' : '',
    hasPendingOnlineMoveRequest ? 'pending-move-piece' : '',
    activeRoomId && !moveActionReadiness.hasAuthoritativeMoveDeadline ? 'authoritative-move-deadline-not-ready' : '',
    !(roll || stackedRollSelectedResult) ? 'no-roll' : '',
    rollResultHolding ? 'roll-result-holding' : '',
    !canMoveSelectedPiece && !noMovableBackDoRoll ? 'selected-piece-not-movable' : '',
  ].filter(Boolean), [activeRoomId, canMoveSelectedPiece, hasPendingOnlineMoveRequest, moveActionReadiness.hasAuthoritativeMoveDeadline, noMovableBackDoRoll, roll, rollPresentationBlocked, rollResultHolding, stackedRollSelectedResult, turnActionBlockReasons]);
  const visibleLogs = useMemo(() => {
    const preservedLogIds = shouldHidePendingRollResultState ? pendingRollAnimationRef.current?.preservedLogIds : null;
    return [...logs]
      .filter((log) => !(activeTurnOrderIntro && log.text.startsWith('순서:')))
      .filter((log) => !preservedLogIds || preservedLogIds.has(log.id))
      .sort((left, right) => right.id - left.id);
  }, [activeTurnOrderIntro, logs, shouldHidePendingRollResultState]);
  const canRollForTurnOrderNow = false;
  liveTurnGuardRef.current = {
    activeSeatId: activeSeat?.id ?? '',
    winner,
    movingPieceId,
    pendingTrapPlacement: Boolean(pendingTrapPlacement),
    turnOrderActive: turnOrderPhase.active,
    turnOrderIntro: Boolean(activeTurnOrderIntro),
  };

  const showBottomBranchControls = Boolean(canUseMoveButton && selectedMoveSteps > 0 && activeMovablePiece?.started && BRANCH_NODE_IDS.includes(activeMovablePiece.nodeId as typeof BRANCH_NODE_IDS[number]));

  // The remaining application body is intentionally preserved from main.
  // This sentinel should never be committed; the connector requires complete file content.
}