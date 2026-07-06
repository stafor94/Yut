import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { BoardPiece } from '../features/game/components/GameBoard';
import type { ItemTiming, ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { BOARD_NODES, BRANCH_NODE_IDS, getBoardNodeById, getMovePathNodeIds, getMovePathNodeIdsWithPrevious, getNearbyNodeIds, spawnInitialBoardItems, type BoardItem, type BranchChoice } from '../game-core/board/board';
import { GOLDEN_YUT_CHOICES, chooseAiRollTimingZone, getRollTimingPositionPercent, getRollTimingZone, rollYutResultWithTiming, makeDisplaySticks, rollYutResult, shouldFallForTimingZone, type RollTimingZone, type YutResult, type YutStick } from '../game-core/roll';
import { canRoll, canSubmitTurnAction as canSubmitTurnActionFromEngine, getRollActionBlockReasons, getTurnActionBlockReasons } from '../game-core/gameEngine';
import { cancelRoomGameStart, commitAuthoritativeGameAction, completeTurnOrderIntro, createRoom, deleteRoom, findActiveRoomByHost, getGameSequencesSince, getProcessedGameAction, getRoom, initializeGameState, isRoomInGame, joinRoom, leaveDuplicatePlayerRooms, markRoomGameEntering, removeRoomPlayer, requestRoomGameStart, resolveTurnOrderIntro, scheduleEmptyRoomDeletion, subscribeRoom, subscribeRoomPlayers, updateRoomOptions, updateRoomPlayer, updateRoomStatus, type GameAction, type GameSeatSnapshot, type GameSequence, type RoomPlayer, type RoomSummary, type SaveGameStateResult } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { useGameSyncDebugState, useGameSyncSubscription } from './hooks/useGameSync';
import { useGameStatePersistence } from './hooks/useGameStatePersistence';
import { usePendingRemoteActions } from './hooks/usePendingRemoteActions';
import { useRoomPresence } from './hooks/useRoomPresence';
import { useTurnOrderAutoFinish, useTurnOrderClock, useTurnOrderPortraitScroll } from './hooks/useTurnOrderTimers';
import { LobbyContainer } from './containers/LobbyContainer';
import { WaitingRoomContainer } from './containers/WaitingRoomContainer';
import { AppModals } from './components/AppModals';
import { AppShellHeader } from './components/AppShellHeader';
import { GameScreenView } from './components/GameScreenView';
import { chooseAiAfterMoveItem, chooseAiGoldenYutResult, chooseAiMove, getAiItemValue, shouldAiUseReroll } from './flows/aiFlow';
import { createStartCountdownWindow, getStartGameBlockMessage } from './flows/gameStartFlow';
import { createGameLogPresentation, isTurnOrderSystemLog } from './flows/gameLogPresentation';
import { getHumanSeatsWaitingForGameEntry, getOnlineGameCoordinatorSeatId, haveAllHumanSeatsEnteredGame } from './flows/onlineGameCoordinator';
import {
  buildAlternatingTeamTurnOrder,
  createTurnOrderIntro,
  formatTurnOrderSummary,
  getTurnOrderFromRolls,
  getTurnOrderLogTexts,
  getTurnOrderScore,
  resolveTurnOrderRolls,
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
  getInitialNickname,
  getStoredBoolean,
  getStoredNumber,
  getStoredPlayMode,
  getStoredText,
  makeGameStateFingerprint,
  makePieces,
  normalizeNickname,
  preserveLockedGameSeats,
  seatsFromGameSeatSnapshots,
  seatsFromRoomPlayers,
  seatsWithJoinedPlayer,
  spectatorsFromRoomPlayers,
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
  type TurnOrderRoll,
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
import { listenAuthState, signInAsGuest } from '../services/firebase/firebaseAuth';
import { playSoundEffect, type SoundEffect } from '../shared/audio/sound';
import { makeGameDiagnosticState } from './diagnostics/gameDiagnostics';
import '../styles/globals.css';

const TURN_DELAY_MS = 1000;
const START_CANCEL_LOCK_MS = 2000;
const SEQUENCE_WATCHDOG_MS = 5000;
const TURN_ORDER_START_DELAY_MS = 3000;
const TURN_ORDER_TIMEOUT_MS = 10000;
const TURN_ORDER_TIMEOUT_FALLBACK_GRACE_MS = 1500;
const TURN_ORDER_PRESENCE_FALLBACK_MS = 8000;
const TURN_ORDER_INITIAL_SLOT_SPIN_MS = 3000;
const TURN_ORDER_SLOT_REVEAL_INTERVAL_MS = 2000;
const TURN_ORDER_LAST_SLOT_REVEAL_INTERVAL_MS = 1000;
const TURN_ORDER_FINAL_HOLD_MS = 2000;
const TURN_ORDER_AI_MIN_DELAY_MS = 2000;
const TURN_ORDER_AI_DELAY_SPREAD_MS = 1000;
const TURN_ORDER_ROLL_ANIMATION_MS = 2600;
const ROLL_RESULT_HOLD_GRACE_MS = 1200;
const ROLL_ANIMATION_MS = 2600;
const ROLL_STUCK_TIMEOUT_MS = 12000;
const TURN_ACTION_TIMEOUT_MS = 15000;
const STALE_PENDING_REMOTE_ACTION_MS = 30000;
const PENALTY_TURN_ACTION_TIMEOUT_MS = 5000;
const ITEM_PROMPT_TIMEOUT_MS = 10000;
const ITEM_REPLACE_TIMEOUT_MS = 10000;
const TRAP_EFFECT_MS = 3000;
const AI_MOVE_DELAY_MS = 1000;
const NO_MOVABLE_PIECE_AUTO_PASS_DELAY_MS = 500;
const AUTO_SINGLE_MOVE_DELAY_MS = 500;
const TOAST_MESSAGE_MS = 4000;
const CREATE_ROOM_TIMEOUT_MS = 12000;
const CREATE_ROOM_CLEANUP_TIMEOUT_MS = 5000;
const CREATE_ROOM_RECOVERY_TIMEOUT_MS = 5000;
const STEP_DELAY_MS = 240;

const getSequenceRefetchAfter = (sequence: number) => Math.max(0, sequence - 2);

const getStableTurnOrderScore = (seed: string, seatId: string) => {
  const value = `${seed}:${seatId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getSeededTurnOrderSeats = (targetSeats: Seat[], seed: string) => [...targetSeats].sort((left, right) => {
  const scoreDiff = getStableTurnOrderScore(seed, left.id) - getStableTurnOrderScore(seed, right.id);
  return scoreDiff || left.label.localeCompare(right.label, undefined, { numeric: true });
});

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const rememberUser = (nextUser: User | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  };
  const [nickname, setNickname] = useState(() => getInitialNickname());
  const [nicknameDraft, setNicknameDraft] = useState(() => getInitialNickname());
  const [nicknameDialogOpen, setNicknameDialogOpen] = useState(false);
  const [endGameDialogOpen, setEndGameDialogOpen] = useState(false);
  const [title, setTitle] = useState(() => getStoredText(STORAGE_KEYS.title, '친구들과 윷놀이'));
  const [playMode, setPlayMode] = useState<PlayMode>(() => getStoredPlayMode());
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(() => getStoredNumber(STORAGE_KEYS.maxPlayers, 4, [2, 3, 4] as const));
  const [itemMode, setItemMode] = useState(() => getStoredBoolean(STORAGE_KEYS.itemMode, true));
  const [stackedRollMode, setStackedRollMode] = useState(() => getStoredBoolean(STORAGE_KEYS.stackedRollMode, false));
  const [pieceCount, setPieceCount] = useState<PieceCount>(() => getStoredNumber(STORAGE_KEYS.pieceCount, 4, [1, 2, 3, 4] as const));
  const [soundEnabled, setSoundEnabled] = useState(() => getStoredBoolean(STORAGE_KEYS.soundEnabled, true));
  const [message, setMessage] = useState('');
  const [actionErrorDialog, setActionErrorDialog] = useState('');
  const [roomNoticeDialog, setRoomNoticeDialog] = useState<{ title: string; message: string } | null>(null);
  const [lastActionDiagnostic, setLastActionDiagnostic] = useState<{ type: string; message: string; reasons: string[]; createdAt: number } | null>(null);
  const [remoteActionDiagnostics, setRemoteActionDiagnostics] = useState<Array<{ type: string; stage: string; status?: string; message: string; actionKey?: string; createdAt: number; sequence: number; turnIndex: number }>>([]);
  const [diagnosticDialogOpen, setDiagnosticDialogOpen] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [manualSequenceSyncing, setManualSequenceSyncing] = useState(false);
  const [lastManualSyncResolution, setLastManualSyncResolution] = useState<ManualSyncResolution | null>(null);
  const [initialGameStateSaveDiagnostic, setInitialGameStateSaveDiagnostic] = useState<{ status: SaveGameStateResult['status'] | 'pending' | 'error' | ''; turnVersion: number; lastSequence: number; startedAt: number; completedAt: number; source: string; message: string; fingerprint: string } | null>(null);
  const [screen, setScreen] = useState<Screen>('lobby');
  const [activeRoomTitle, setActiveRoomTitle] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [activeRoomHostId, setActiveRoomHostId] = useState('');
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [countdown, setCountdown] = useState(-1);
  const [startRequestVersion, setStartRequestVersion] = useState(0);
  const [startCountdownStartsAt, setStartCountdownStartsAt] = useState(0);
  const [startCountdownEndsAt, setStartCountdownEndsAt] = useState(0);
  const [startStatus, setStartStatus] = useState<RoomSummary['startStatus']>('idle');
  const [authoritativeGameStateReady, setAuthoritativeGameStateReady] = useState(false);
  const [firebaseLatencySamples, setFirebaseLatencySamples] = useState<number[]>([]);
  const [spectators, setSpectators] = useState<Seat[]>([]);
  const [pendingItemPickup, setPendingItemPickup] = useState<PendingItemPickup | null>(null);
  const [seats, setSeats] = useState<Seat[]>(() => createSeats('플레이어', 'individual', 4));
  const [pieces, setPieces] = useState<BoardPiece[]>(() => makePieces(createSeats('플레이어', 'individual', 4), 4));
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [gameStartedAt, setGameStartedAt] = useState<number | null>(null);
  const [playTimeNow, setPlayTimeNow] = useState(() => Date.now());
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
  const [turnDeadlineKind, setTurnDeadlineKind] = useState<'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | ''>('');
  const [turnOrderClock, setTurnOrderClock] = useState(() => Date.now());
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const piecesRef = useRef<BoardPiece[]>([]);
  const [captureEffect, setCaptureEffect] = useState<CaptureEffect | null>(null);
  const [trapEffect, setTrapEffect] = useState<TrapEffect | null>(null);
  const [fallEffect, setFallEffect] = useState<FallEffect | null>(null);
  const [rollTimingFeedback, setRollTimingFeedback] = useState<RollTimingZone | null>(null);
  const [lastRollTimingZone, setLastRollTimingZone] = useState<RollTimingZone | null>(null);
  const [pendingTrapPlacement, setPendingTrapPlacement] = useState<PendingTrapPlacement | null>(null);
  const [forcedRoll, setForcedRoll] = useState<YutResult | null>(null);
  const [goldenYutPickerOpen, setGoldenYutPickerOpen] = useState(false);
  const [itemPromptTiming, setItemPromptTiming] = useState<ItemTiming | null>(null);
  const [rollLockUntil, setRollLockUntil] = useState(0);
  const [rollLockClock, setRollLockClock] = useState(() => Date.now());
  const [rollResultReadyAt, setRollResultReadyAt] = useState(0);
  const [trapPlacementClock, setTrapPlacementClock] = useState(() => Date.now());
  const [itemPickupClock, setItemPickupClock] = useState(() => Date.now());
  const [rollInProgress, setRollInProgress] = useState(false);
  const [moveInProgress, setMoveInProgress] = useState(false);
  const [turnActionTimeoutPenaltyBySeatId, setTurnActionTimeoutPenaltyBySeatId] = useState<Record<string, boolean>>({});
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
  const localActionCommitQueueRef = useRef(Promise.resolve());
  const sequenceReplayInProgressRef = useRef(false);
  const queuedSyncedStateRef = useRef<SequenceStateSnapshot | null>(null);
  const completingTurnOrderIntroRef = useRef<Set<number>>(new Set());
  const remoteActionRetryTimersRef = useRef<Map<string, number>>(new Map());
  const currentRollRef = useRef<YutResult | null>(null);
  const rollAnimationTimerRef = useRef<number | null>(null);
  const pendingItemPickupResolverRef = useRef<(() => void) | null>(null);
  const lastSequenceWatchdogAtRef = useRef(0);
  const stalledTurnWatchKeyRef = useRef('');
  const stalledTurnStartedAtRef = useRef(0);
  const stalledTurnRecoveryKeyRef = useRef('');
  const enteredGamePresenceKeyRef = useRef('');
  const startedGameRequestVersionsRef = useRef<Set<number>>(new Set());
  const timeoutRecoveryKeysRef = useRef<Set<string>>(new Set());

  const getTurnActionTimeoutMs = (seatId = activeSeat?.id ?? '') => turnActionTimeoutPenaltyBySeatId[seatId] ? PENALTY_TURN_ACTION_TIMEOUT_MS : TURN_ACTION_TIMEOUT_MS;
  const getItemPromptTimeoutMs = (seatId = localSeatId) => turnActionTimeoutPenaltyBySeatId[seatId] ? PENALTY_TURN_ACTION_TIMEOUT_MS : ITEM_PROMPT_TIMEOUT_MS;
  const markTurnActionTimedOut = (seatId = activeSeat?.id ?? localSeatId) => {
    if (!seatId) return;
    setTurnActionTimeoutPenaltyBySeatId((current) => current[seatId] ? current : { ...current, [seatId]: true });
  };
  const clearTurnActionTimeoutPenalty = (seatId = activeSeat?.id ?? localSeatId) => {
    if (!seatId) return;
    setTurnActionTimeoutPenaltyBySeatId((current) => current[seatId] ? { ...current, [seatId]: false } : current);
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
  const lastWinnerSoundRef = useRef('');
  const lastBranchControlKeyRef = useRef('');
  const aiTurnActionKeyRef = useRef('');
  const liveTurnGuardRef = useRef({ activeSeatId: '', winner: '', movingPieceId: '', pendingTrapPlacement: false, turnOrderActive: false, turnOrderIntro: false });
  const activeRoomIdRef = useRef('');
  const activeRoomHostIdRef = useRef('');
  const logIdRef = useRef(0);
  const spectatorIdsRef = useRef<Set<string>>(new Set());
  const roomPlayerAiStatesRef = useRef<Map<string, { isAI: boolean; isSpectator: boolean; nickname: string }>>(new Map());
  const pendingAiSeatIdsRef = useRef<Set<string>>(new Set());
  const confirmedRoomPlayerRef = useRef(false);
  const leavingRoomRef = useRef(false);
  const hostingRoomUserIdRef = useRef('');
  const rooms = useRooms();
  const currentUser = userRef.current ?? user;
  const currentUserId = currentUser?.uid ?? '';
  const serverStatus = manualSequenceSyncing ? '동기화 중...' : isFirebaseConfigured ? (currentUser ? '온라인' : '입장 준비 중') : '연결 정보 확인 필요';
  const serverStatusTone = isFirebaseConfigured ? (currentUser ? 'online' : 'pending') : 'offline';
  const displaySeats = useMemo(() => screen === 'game' ? seats.map((seat) => ({ ...seat, isHost: false })) : seats, [screen, seats]);
  const playableSeats = useMemo(() => displaySeats.filter((seat) => !seat.isEmpty), [displaySeats]);
  const syncedGameSeats = useMemo(() => gameSeatSnapshotsFromSeats(playableSeats), [playableSeats]);
  const teamCounts = useMemo(() => playableSeats.reduce<Record<Team, number>>((acc, seat) => ({ ...acc, [seat.team]: acc[seat.team] + 1 }), { 청팀: 0, 홍팀: 0 }), [playableSeats]);
  const teamBalanced = playMode === 'individual' || (maxPlayers === 4 && teamCounts.청팀 === 2 && teamCounts.홍팀 === 2);
  const allReady = seats.every((seat) => !seat.isEmpty && (seat.ready || seat.isAI)) && teamBalanced;
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
  const waitingRoomHostSeatId = (!activeRoomId || screen === 'waitingRoom') ? playableSeats.find((seat) => seat.isHost)?.id ?? (activeRoomHostId || 'host') : '';
  const localSeatId = activeRoomId ? currentUserId : waitingRoomHostSeatId;
  const isSpectator = Boolean(activeRoomId && currentUserId && spectators.some((spectator) => spectator.id === currentUserId));
  const hasWaitingRoomHostAuthority = Boolean(screen === 'waitingRoom' && currentUserId && (activeRoomHostId === currentUserId || waitingRoomHostSeatId === currentUserId));
  const isWaitingRoomHost = Boolean(screen === 'waitingRoom' && isRoomHost);
  const onlineGameRole = !activeRoomId ? 'offline' : isSpectator ? 'spectator' : hasWaitingRoomHostAuthority ? 'waiting-room-host' : 'player';
  const isRoomManager = hasWaitingRoomHostAuthority || isWaitingRoomHost;
  const isOnlinePlayer = onlineGameRole === 'player';
  const onlineGameCoordinatorSeatId = getOnlineGameCoordinatorSeatId(playableSeats);
  const canCoordinateOnlineGame = !activeRoomId || Boolean(isOnlinePlayer && localSeatId && localSeatId === onlineGameCoordinatorSeatId);
  const canResolveInitialOnlineTurnOrder = canCoordinateOnlineGame;
  const canCompleteInitialOnlineTurnOrderIntro = canCoordinateOnlineGame || Boolean(activeRoomId && isOnlinePlayer);
  const canManageRoom = isRoomManager;
  const gameExitDescription = activeRoomId ? '현재 방에서 나가 로비로 이동합니다. 모든 사람 플레이어가 나가면 방이 종료됩니다.' : 'AI가 대신 플레이하게 됩니다.';
  const isMyTurn = activeSeat?.id === localSeatId && !activeSeat.isAI && !isSpectator;
  const getSeatById = (seatId: string) => playableSeats.find((seat) => seat.id === seatId);
  const getSeatColorIndex = (seat: Seat | undefined) => Math.max(0, Number(seat?.label.replace('P', '')) - 1);
  const getSeatPieceColor = (seat: Seat | undefined) => PLAYER_COLORS[getSeatColorIndex(seat)] ?? '#2a1e17';
  const getSeatPieceColorLabel = (seat: Seat | undefined) => PLAYER_COLOR_LABELS[getSeatColorIndex(seat)] ?? seat?.color ?? '검정';
  const isSameSide = (a: Seat | undefined, b: Seat | undefined) => Boolean(a && b && (playMode === 'team' ? a.team === b.team : a.id === b.id));
  const getPieceSideKey = (piece: BoardPiece) => playMode === 'team' ? getSeatById(piece.ownerId)?.team ?? piece.ownerId : piece.ownerId;
  const canSeatControlPiece = (seat: Seat | undefined, piece: BoardPiece | undefined) => Boolean(seat && piece && isSameSide(getSeatById(piece.ownerId), seat));
  const selectedPiece = useMemo(() => pieces.find((piece) => piece.id === selectedPieceId), [pieces, selectedPieceId]);
  const selectedGroupPieceIds = useMemo(() => {
    const offBoardSelectionIds = roll && activeSeat && isMyTurn && roll.steps >= 0 && !pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished)
      ? pieces
          .filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.started && !piece.finished)
          .map((piece) => piece.id)
      : [];
    if (offBoardSelectionIds.length) return offBoardSelectionIds;
    if (!selectedPiece || !selectedPiece.started || selectedPiece.finished) return selectedPiece && !selectedPiece.finished ? [selectedPiece.id] : [];
    const selectedOwnerSeat = getSeatById(selectedPiece.ownerId);
    return pieces
      .filter((piece) => piece.started && !piece.finished && piece.nodeId === selectedPiece.nodeId && isSameSide(getSeatById(piece.ownerId), selectedOwnerSeat))
      .map((piece) => piece.id);
  }, [activeSeat, isMyTurn, pieces, playMode, playableSeats, roll, selectedPiece]);
  const trapPlacementNodeIds = pendingTrapPlacement?.nodeIds ?? [];
  const selectedBranchControlKey = selectedPiece && roll && selectedPiece.started && BRANCH_NODE_IDS.includes(selectedPiece.nodeId as typeof BRANCH_NODE_IDS[number]) ? `${selectedPiece.id}:${selectedPiece.nodeId}:${roll.name}:${roll.steps}` : '';
  const displayBranchChoice: BranchChoice = selectedBranchControlKey && lastBranchControlKeyRef.current !== selectedBranchControlKey ? 'shortcut' : branchChoice;
  const previewNodeIds = useMemo(() => isMyTurn && !movingPieceId && canSeatControlPiece(activeSeat, selectedPiece) ? getMovePreviewNodeIds(selectedPiece, roll, displayBranchChoice) : [], [activeSeat, displayBranchChoice, isMyTurn, movingPieceId, roll, selectedPiece]);
  const formatPlayTime = (elapsedMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const two = (value: number) => String(value).padStart(2, '0');
    return hours > 0 ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
  };
  const playTimeText = gameStartedAt ? formatPlayTime(playTimeNow - gameStartedAt) : '00:00';
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
  const stackedRollSelectedResult = stackedRollMode && rollStackClosed && rollStack.length ? (typeof selectedRollStackIndex === 'number' ? rollStack[selectedRollStackIndex] : rollStack.length === 1 ? rollStack[0] : null) : null;
  const selectedMoveSteps = (stackedRollSelectedResult ?? roll)?.steps ?? 0;
  const isRollLocked = rollLockUntil > rollLockClock;
  const effectiveRollResultReadyAt = normalizeRollResultReadyAt(rollResultReadyAt);
  const rollResultHolding = effectiveRollResultReadyAt > rollLockClock;
  const activeTurnOrderIntro = turnOrderIntro && turnOrderIntro.readyAt > turnOrderClock ? turnOrderIntro : null;
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
    rollLockUntil,
    lastMovedPieceIds,
    lastMovedSeatId,
    effectiveRollResultReadyAt,
    turnOrderPhase,
    waitingForPlayersReady,
    turnDeadlineAt,
    turnDeadlineKind,
    startRequestVersion,
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
  });
  const onlineAuthoritativeGameStatePending = Boolean(activeRoomId && screen === 'game' && !authoritativeGameStateReady);
  const hasPendingGameStateSave = Boolean(activeRoomId && screen === 'game' && (onlineAuthoritativeGameStatePending || (canCoordinateOnlineGame && coordinatorStateSaveKey)));
  const shouldWaitForAuthoritativeTurnSync = Boolean(activeRoomId && screen === 'game' && pendingLocalRemoteActionCount > 0 && !isMyTurn);
  const effectivePendingLocalRemoteActionCount = shouldWaitForAuthoritativeTurnSync ? pendingLocalRemoteActionCount : 0;
  const turnActionGuardInput = {
    activeSeatId: activeSeat?.id,
    actorId: localSeatId,
    isActorAI: Boolean(activeSeat?.isAI),
    isSpectator,
    winner,
    waitingForTurnOrder: waitingForOnlineTurnOrder,
    turnOrderPhaseActive: turnOrderPhase.active,
    turnOrderIntroActive: Boolean(activeTurnOrderIntro),
    movingPieceId,
    pendingTrapPlacement: trapPlacementActive,
    pendingGameStateSave: hasPendingGameStateSave,
    pendingLocalRemoteActionCount: effectivePendingLocalRemoteActionCount,
    processingActionCount: processingActionIdsRef.current.size,
  };
  const rollActionGuardInput = {
    ...turnActionGuardInput,
    roll: stackedRollMode && rollStack.length > 0 && !rollStackClosed ? null : roll,
    rollLocked: isRollLocked,
    remoteActionClient: false,
    rollInProgress,
  };
  const turnActionBlockReasons = useMemo(() => getTurnActionBlockReasons(turnActionGuardInput), [activeSeat?.id, activeSeat?.isAI, activeTurnOrderIntro, hasPendingGameStateSave, isSpectator, localSeatId, movingPieceId, effectivePendingLocalRemoteActionCount, trapPlacementActive, turnOrderPhase.active, waitingForOnlineTurnOrder, winner]);
  const canSubmitTurnAction = canSubmitTurnActionFromEngine(turnActionGuardInput);
  const selectedPieceCanMove = Boolean((roll || stackedRollSelectedResult) && activeSeat && isMyTurn && canSeatControlPiece(activeSeat, selectedPiece) && !selectedPiece?.finished && (selectedMoveSteps >= 0 || selectedPiece?.started));
  const activeSeatPiecesOnBoard = useMemo(() => activeSeat
    ? pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished)
    : false, [activeSeat, pieces]);
  const fallbackMovablePiece = useMemo(() => {
    if (!(roll || stackedRollSelectedResult) || !activeSeat || !isMyTurn) return undefined;
    const movablePieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (selectedMoveSteps >= 0 || piece.started));
    if (!activeSeatPiecesOnBoard) {
      return [...movablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
    }
    return movablePieces[0];
  }, [activeSeat, activeSeatPiecesOnBoard, isMyTurn, pieces, roll, stackedRollSelectedResult, selectedMoveSteps]);
  const activeMovablePiece = selectedPieceCanMove ? selectedPiece : fallbackMovablePiece;
  const canMoveSelectedPiece = Boolean(activeMovablePiece);
  const canRequestMove = Boolean(canSubmitTurnAction && (roll || stackedRollSelectedResult) && !rollResultHolding && !rollAnimation && !moveInProgress && !movingPieceId && canMoveSelectedPiece);
  const canUseMoveButton = canRequestMove;
  const rollActionBlockReasons = useMemo(() => getRollActionBlockReasons(rollActionGuardInput), [activeSeat?.id, activeSeat?.isAI, activeTurnOrderIntro, hasPendingGameStateSave, isRollLocked, isSpectator, localSeatId, movingPieceId, effectivePendingLocalRemoteActionCount, roll, rollInProgress, trapPlacementActive, turnOrderPhase.active, waitingForOnlineTurnOrder, winner, stackedRollMode, rollStack.length, rollStackClosed]);
  const canRollNow = canRoll(rollActionGuardInput) && !rollAnimation;
  const stalledTurnMovablePieces = useMemo(() => {
    if (!roll || !activeSeat) return [];
    const steps = roll.steps;
    return pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (steps >= 0 || piece.started));
  }, [activeSeat, pieces, roll]);
  const stalledTurnFallbackPiece = useMemo(() => {
    if (!roll || !activeSeat || !stalledTurnMovablePieces.length) return undefined;
    const hasPieceOnBoard = pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished);
    return hasPieceOnBoard ? stalledTurnMovablePieces[0] : [...stalledTurnMovablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
  }, [activeSeat, pieces, roll, stalledTurnMovablePieces]);
  const stalledTurnNeedsBranchChoice = Boolean(stalledTurnFallbackPiece && roll && roll.steps > 0 && stalledTurnFallbackPiece.started && BRANCH_NODE_IDS.includes(stalledTurnFallbackPiece.nodeId as typeof BRANCH_NODE_IDS[number]));
  const stalledTurnWatchKey = activeRoomId && screen === 'game' && roll && activeSeat
    ? `${activeRoomId}:${lastAppliedSequenceRef.current}:${turnIndex}:${activeSeat.id}:${roll.name}:${roll.steps}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`
    : '';
  const stalledTurnAgeMs = stalledTurnWatchKey && stalledTurnStartedAtRef.current ? Math.max(0, Date.now() - stalledTurnStartedAtRef.current) : 0;
  const getCurrentStalledTurnSyncAgeMs = () => {
    if (!stalledTurnWatchKey) return 0;
    if (turnDeadlineKind === 'move' && turnDeadlineAt) return Math.max(0, Date.now() - turnDeadlineAt + TURN_ACTION_TIMEOUT_MS);
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
  const boardTurnIndicatorRollStack = !winner && visibleBoardTurnSeat && stackedRollMode ? rollStack : [];
  const boardTurnIndicatorColor = winner ? '#1f1a17' : visibleBoardTurnSeat ? (playMode === 'team' ? TEAM_COLORS[visibleBoardTurnSeat.team] : getSeatPieceColor(visibleBoardTurnSeat)) : undefined;
  const moveActionBlockReasons = useMemo(() => [
    ...turnActionBlockReasons,
    !roll ? 'no-roll' : '',
    rollResultHolding ? 'roll-result-holding' : '',
    !canMoveSelectedPiece ? 'selected-piece-not-movable' : '',
  ].filter(Boolean), [canMoveSelectedPiece, roll, rollResultHolding, turnActionBlockReasons]);
  const visibleLogs = useMemo(() => [...logs]
    .filter((log) => !(activeTurnOrderIntro && log.text.startsWith('순서:')))
    .sort((left, right) => right.id - left.id), [activeTurnOrderIntro, logs]);
  const rolledTurnOrderSeatIds = useMemo(() => new Set(turnOrderPhase.rolls.map((rollEntry) => rollEntry.seat.id)), [turnOrderPhase.rolls]);
  const localTurnOrderSeatRolled = rolledTurnOrderSeatIds.has(localSeatId);
  const isTurnOrderTimedOut = Boolean(turnOrderPhase.active && turnOrderPhase.deadline > 0 && turnOrderClock >= turnOrderPhase.deadline && playableSeats.some((seat) => !rolledTurnOrderSeatIds.has(seat.id)));
  const isTurnOrderFallbackDue = Boolean(turnOrderPhase.active && turnOrderPhase.deadline > 0 && turnOrderClock >= turnOrderPhase.deadline + TURN_ORDER_TIMEOUT_FALLBACK_GRACE_MS);
  const canForceTurnOrderProgress = Boolean(isTurnOrderTimedOut && canCoordinateOnlineGame);
  liveTurnGuardRef.current = {
    activeSeatId: activeSeat?.id ?? '',
    winner,
    movingPieceId,
    pendingTrapPlacement: Boolean(pendingTrapPlacement),
    turnOrderActive: turnOrderPhase.active,
    turnOrderIntro: Boolean(activeTurnOrderIntro),
  };

  const turnOrderTimerText = (() => {
    if (!turnOrderPhase.active) return '';
    if (turnOrderPhase.readyAt > turnOrderClock) {
      return `시작까지 ${Math.max(0, Math.floor((turnOrderPhase.readyAt - turnOrderClock) / 1000))}초`;
    }
    if (turnOrderPhase.deadline > 0 && turnOrderClock >= turnOrderPhase.deadline + TURN_ORDER_TIMEOUT_FALLBACK_GRACE_MS) return '자동 확정 중...';
    if (turnOrderPhase.deadline > 0 && turnOrderClock >= turnOrderPhase.deadline && playableSeats.some((seat) => !rolledTurnOrderSeatIds.has(seat.id))) return '자동 진행 중...';
    return `남은 시간 ${Math.max(0, Math.floor((turnOrderPhase.deadline - turnOrderClock) / 1000))}초`;
  })();
  const showBottomBranchControls = Boolean(canUseMoveButton && selectedMoveSteps > 0 && activeMovablePiece?.started && BRANCH_NODE_IDS.includes(activeMovablePiece.nodeId as typeof BRANCH_NODE_IDS[number]));
  const activeItemPromptTypes = itemPromptTiming && !trapPlacementActive ? getUsableHostItems(itemPromptTiming) : [];
  const roomInGame = startStatus === 'entering' || startStatus === 'playing';
  const startCountdownActive = startStatus === 'requested' && startCountdownEndsAt > Date.now();
  const startCancelDisabled = startCountdownEndsAt > 0 && startCountdownEndsAt - Date.now() <= START_CANCEL_LOCK_MS;
  const optimisticEnteredSeatId = screen === 'game' && localSeatId && !isSpectator ? localSeatId : '';
  const humanSeatsWaitingToEnter = startRequestVersion ? getHumanSeatsWaitingForGameEntry(playableSeats, startRequestVersion, optimisticEnteredSeatId) : [];
  const allHumansEnteredGame = Boolean(startRequestVersion && haveAllHumanSeatsEnteredGame(playableSeats, startRequestVersion, optimisticEnteredSeatId));
  const pendingSequenceMetaDiagnostic = pendingSequenceMetaRef.current ? {
    type: pendingSequenceMetaRef.current.type,
    actorId: pendingSequenceMetaRef.current.actorId,
    clientMutationId: pendingSequenceMetaRef.current.clientMutationId ?? '',
    payloadKeys: Object.keys(pendingSequenceMetaRef.current.payload ?? {}),
    actionType: pendingSequenceMetaRef.current.action?.type ?? '',
    actionActorId: pendingSequenceMetaRef.current.action?.actorId ?? '',
    actionPayloadKeys: Object.keys(pendingSequenceMetaRef.current.action?.payload ?? {}),
  } : null;
  const actionPipelineDiagnostic = {
    pendingLocalRemoteActions: Array.from(pendingLocalRemoteActionsRef.current).map((key) => {
      const meta = pendingLocalRemoteActionMetaRef.current.get(key);
      return { key, type: meta?.type ?? getPendingLocalRemoteActionType(key), ageMs: meta ? Math.max(0, Date.now() - meta.createdAt) : 0 };
    }),
    processingActionIds: Array.from(processingActionIdsRef.current),
    completedActionIds: Array.from(completedActionIdsRef.current).slice(-20),
    rejectedRemoteActionKeys: Array.from(rejectedRemoteActionKeysRef.current).slice(-20),
    localClientMutationIds: Array.from(localClientMutationIdsRef.current).slice(-20),
  };
  const syncPipelineDiagnostic = {
    applyingSyncedState: applyingSyncedStateRef.current,
    sequenceReplayInProgress: sequenceReplayInProgressRef.current,
    queuedSyncedStateSequence: Number(queuedSyncedStateRef.current?.lastSequence ?? 0),
    lastAppliedStateVersion: lastAppliedStateVersionRef.current,
    lastAppliedSequence: lastAppliedSequenceRef.current,
    coordinatorStateSaveKey,
    hasPendingGameStateSave,
    onlineAuthoritativeGameStatePending,
    authoritativeGameStateReady,
    coordinatorStateSaveRetryTick,
    pendingSequenceMeta: pendingSequenceMetaDiagnostic,
    savingStateFingerprint: savingStateFingerprintRef.current ? savingStateFingerprintRef.current.slice(0, 24) : '',
    lastSavedStateFingerprint: lastSavedStateFingerprintRef.current ? lastSavedStateFingerprintRef.current.slice(0, 24) : '',
    lastSequenceWatchdogAgeMs: lastSequenceWatchdogAtRef.current ? Math.max(0, Date.now() - lastSequenceWatchdogAtRef.current) : null,
    initialGameStateSave: initialGameStateSaveDiagnostic,
  };
  const turnHealthDiagnostic = {
    activeSeatId: activeSeat?.id ?? '',
    activeSeatLabel: activeSeat?.label ?? '',
    localSeatId,
    currentUserId,
    onlineGameCoordinatorSeatId,
    canCoordinateOnlineGame,
    isMyTurn,
    canSubmitTurnAction,
    canRollNow,
    canRequestMove,
    turnActionBlockReasons,
    rollActionBlockReasons,
    moveActionBlockReasons,
    liveTurnGuard: liveTurnGuardRef.current,
    waitingForPlayersReady,
    allHumansEnteredGame,
    humanSeatsWaitingToEnter: humanSeatsWaitingToEnter.map((seat) => ({ id: seat.id, label: seat.label, enteredStartVersion: seat.enteredStartVersion ?? 0 })),
    startRequestVersion,
  };
  const getStalledTurnSyncResolution = (): StalledTurnSyncResolution => {
    const currentAgeMs = getCurrentStalledTurnSyncAgeMs();
    if (!activeRoomId || screen !== 'game' || !roll || !activeSeat || !stalledTurnWatchKey) return { status: 'not-stalled', reason: 'no-active-roll-turn', ageMs: 0 };
    if (winner) return { status: 'blocked', reason: 'winner', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey };
    if (rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) return { status: 'blocked', reason: 'transient-turn-effect', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey };
    if (!stalledTurnMovablePieces.length || !stalledTurnFallbackPiece) return { status: 'blocked', reason: 'no-movable-piece', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey };
    if (stalledTurnNeedsBranchChoice) return { status: 'blocked', reason: 'branch-choice-required', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey, pieceId: stalledTurnFallbackPiece.id };
    if (!isOnlinePlayer) return { status: 'blocked', reason: 'not-online-player', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey, pieceId: stalledTurnFallbackPiece.id };
    if (stalledTurnRecoveryKeyRef.current === stalledTurnWatchKey) return { status: 'blocked', reason: 'already-recovery-requested', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey, pieceId: stalledTurnFallbackPiece.id };
    if (currentAgeMs < TURN_ACTION_TIMEOUT_MS) return { status: 'waiting', reason: 'turn-action-timeout-not-reached', ageMs: currentAgeMs, recoveryAfterMs: TURN_ACTION_TIMEOUT_MS };
    return { status: 'recoverable', reason: 'stalled-roll-move-timeout', ageMs: currentAgeMs, recoveryKey: stalledTurnWatchKey, pieceId: stalledTurnFallbackPiece.id };
  };

  useEffect(() => {
    if (screen !== 'game') return;
    if (!isMyTurn) {
      if (selectedPieceId) setSelectedPieceId('');
      return;
    }
    if (selectedPiece && (selectedPiece.finished || !canSeatControlPiece(activeSeat, selectedPiece))) setSelectedPieceId('');
  }, [activeSeat, isMyTurn, playableSeats, playMode, screen, selectedPiece, selectedPieceId]);

  useEffect(() => {
    if (!roll || !activeSeat || !isMyTurn) return;
    const steps = roll.steps;
    const canMovePiece = (piece: BoardPiece) => steps >= 0 || piece.started;
    const selectedPieceCanMove = Boolean(selectedPiece && canSeatControlPiece(activeSeat, selectedPiece) && !selectedPiece.finished && canMovePiece(selectedPiece));
    if (selectedPieceCanMove) return;
    const movablePieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece));
    const hasPieceOnBoard = pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished);
    const fallbackPiece = hasPieceOnBoard ? movablePieces[0] : [...movablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
    if (fallbackPiece && fallbackPiece.id !== selectedPieceId) setSelectedPieceId(fallbackPiece.id);
  }, [activeSeat, isMyTurn, pieces, roll, selectedPiece, selectedPieceId]);

  const diagnosticState = useMemo(() => makeGameDiagnosticState({
    screen,
    activeRoomId,
    isWaitingRoomHost,
    onlineGameRole,
    isRoomManager,
    isOnlinePlayer,
    onlineGameCoordinatorSeatId,
    canCoordinateOnlineGame,
    canManageRoom,
    currentUserId,
    localSeatId,
    waitingRoomHostSeatId,
    allReady,
    teamBalanced,
    displaySeats,
    message,
    actionErrorDialog,
    lastActionDiagnostic,
    remoteActionDiagnostics,
    lastManualSyncResolution,
    turnOrderIds,
    initialTurnOrderIds,
    completedSeatIds,
    rankingSeatIds,
    gameEndMode,
    lastFinishedSeatId,
    continuationRound,
    unfinishedRaceSeatIds,
    canShowContinueRaceButton,
    roll,
    rollInProgress,
    rollInProgressRef,
    coordinatorStateSaveKey,
    hasPendingGameStateSave,
    isRollLocked,
    rollLockUntil,
    rollResultReadyAt,
    effectiveRollResultReadyAt,
    rollLockClock,
    rollResultHolding,
    turnOrderIntro,
    activeTurnOrderIntro,
    waitingForOnlineTurnOrder,
    turnDeadlineAt,
    turnDeadlineKind,
    turnIndex,
    lastAppliedStateVersionRef,
    lastAppliedSequenceRef,
    syncPipelineDiagnostic,
    actionPipelineDiagnostic,
    turnHealthDiagnostic,
    pendingLocalRemoteActionCount,
    pendingLocalRemoteActionsRef,
    pendingLocalRemoteActionMetaRef,
    getPendingLocalRemoteActionType,
    turnActionTimeoutPenaltyBySeatId,
    activeSeat,
    getTurnActionTimeoutMs,
    getItemPromptTimeoutMs,
    processingActionIdsRef,
    completedActionIdsRef,
    lastMovedSeatId,
    lastMovedPieceIds,
    pieces,
    isMyTurn,
    canSubmitTurnAction,
    canRollNow,
    canMoveSelectedPiece,
    canRequestMove,
    turnActionBlockReasons,
    rollActionBlockReasons,
    moveActionBlockReasons,
    stalledTurnDetected,
    stalledTurnReason,
    stalledTurnAgeMs,
    stalledTurnSyncAgeMs,
    stalledTurnWatchKey,
    stalledTurnNeedsBranchChoice,
    stalledTurnFallbackPiece,
    stalledTurnMovablePieces,
    getStalledTurnSyncResolution,
    selectedPieceId,
    selectedPiece,
    selectedPieceCanMove,
    activeSeatPiecesOnBoard,
    fallbackMovablePiece,
    activeMovablePiece,
    selectedMoveSteps,
    canSeatControlPiece,
    visibleLogs,
    boardItems,
    ownedItems,
    trapNodes,
    shieldedPieceIds,
    pendingTrapPlacement,
    itemPromptTiming,
    branchChoice,
    turnActionTimeoutMs: TURN_ACTION_TIMEOUT_MS,
  }), [actionErrorDialog, actionPipelineDiagnostic, activeRoomId, activeSeat, activeTurnOrderIntro, allReady, onlineGameRole, isRoomManager, isOnlinePlayer, onlineGameCoordinatorSeatId, canCoordinateOnlineGame, canManageRoom, canMoveSelectedPiece, canRequestMove, canRollNow, canShowContinueRaceButton, canSubmitTurnAction, completedSeatIds, continuationRound, currentUserId, effectiveRollResultReadyAt, gameEndMode, hasPendingGameStateSave, waitingRoomHostSeatId, coordinatorStateSaveKey, initialTurnOrderIds, isMyTurn, isRollLocked, isWaitingRoomHost, lastActionDiagnostic, lastFinishedSeatId, lastManualSyncResolution, localSeatId, message, moveActionBlockReasons, pendingLocalRemoteActionCount, remoteActionDiagnostics, syncPipelineDiagnostic, turnActionTimeoutPenaltyBySeatId, turnHealthDiagnostic, pieces, rankingSeatIds, roll, rollInProgress, rollLockClock, rollLockUntil, rollActionBlockReasons, rollResultHolding, rollResultReadyAt, screen, seats, selectedPiece, selectedPieceId, teamBalanced, turnActionBlockReasons, turnDeadlineAt, turnDeadlineKind, turnIndex, turnOrderIds, turnOrderIntro, unfinishedRaceSeatIds, waitingForOnlineTurnOrder, lastMovedSeatId, lastMovedPieceIds, visibleLogs, displaySeats, boardItems, ownedItems, trapNodes, shieldedPieceIds, pendingTrapPlacement, itemPromptTiming, branchChoice, selectedPieceCanMove, activeSeatPiecesOnBoard, fallbackMovablePiece, activeMovablePiece, selectedMoveSteps, stalledTurnAgeMs, stalledTurnDetected, stalledTurnFallbackPiece, stalledTurnMovablePieces, stalledTurnNeedsBranchChoice, stalledTurnReason, stalledTurnSyncAgeMs, stalledTurnWatchKey]);
  const diagnosticText = useMemo(() => JSON.stringify({ capturedAt: new Date().toISOString(), state: diagnosticState }, null, 2), [diagnosticState]);


  useGameSyncDebugState(diagnosticState);

  useEffect(() => {
    if (!stalledTurnWatchKey || !roll || !activeSeat || !stalledTurnMovablePieces.length || winner || rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) {
      stalledTurnWatchKeyRef.current = '';
      stalledTurnStartedAtRef.current = 0;
      return undefined;
    }
    if (stalledTurnWatchKeyRef.current !== stalledTurnWatchKey) {
      stalledTurnWatchKeyRef.current = stalledTurnWatchKey;
      stalledTurnStartedAtRef.current = Date.now();
    }
    const resolution = getStalledTurnSyncResolution();
    if (resolution.status === 'blocked' && resolution.reason === 'branch-choice-required' && resolution.ageMs >= TURN_ACTION_TIMEOUT_MS) {
      stalledTurnRecoveryKeyRef.current = stalledTurnWatchKey;
      const messageText = `${getSeatDisplayName(activeSeat)}님의 이동이 멈춘 상태입니다. 분기점 방향 선택이 필요해 자동 복구를 보류했습니다.`;
      recordRemoteActionDiagnostic('move_piece', 'stalled-turn-branch-choice-required', messageText, { actionKey: stalledTurnWatchKey });
      setMessage(messageText);
      return undefined;
    }
    if (resolution.status !== 'waiting' && resolution.status !== 'recoverable') return undefined;
    const delayMs = resolution.status === 'waiting' ? Math.max(0, resolution.recoveryAfterMs - resolution.ageMs) : 0;
    const timer = window.setTimeout(() => {
      if (stalledTurnRecoveryKeyRef.current === stalledTurnWatchKey) return;
      void recoverStalledTurnMove(stalledTurnWatchKey);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeSeat, isOnlinePlayer, movingPieceId, moveInProgress, pendingTrapPlacement, roll, rollAnimation, rollResultHolding, stalledTurnMovablePieces.length, stalledTurnNeedsBranchChoice, stalledTurnSyncAgeMs, stalledTurnWatchKey, turnDeadlineAt, turnDeadlineKind, winner]);

  useEffect(() => {
    if (!canSubmitDeadlineRecovery() || !activeRoomId || !activeSeat || roll || turnDeadlineKind !== 'roll' || !turnDeadlineAt) return undefined;
    const recoveryKey = `${activeRoomId}:${lastAppliedSequenceRef.current}:${turnIndex}:${activeSeat.id}:roll:${turnDeadlineAt}`;
    const runRecovery = () => {
      if (Date.now() < turnDeadlineAt || timeoutRecoveryKeysRef.current.has(recoveryKey)) return;
      void recoverTimedOutRoll(recoveryKey);
    };
    const delayMs = Math.max(0, turnDeadlineAt - Date.now());
    const timer = window.setTimeout(runRecovery, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, activeSeat?.id, activeTurnOrderIntro, isOnlinePlayer, movingPieceId, moveInProgress, pendingTrapPlacement, roll, rollAnimation, screen, turnDeadlineAt, turnDeadlineKind, turnIndex, turnOrderPhase.active, winner]);

  useEffect(() => {
    if (!activeRoomId || screen !== 'game') return undefined;
    const handleResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (turnDeadlineKind === 'roll' && turnDeadlineAt && Date.now() >= turnDeadlineAt && activeSeat && !roll) {
        const recoveryKey = `${activeRoomId}:${lastAppliedSequenceRef.current}:${turnIndex}:${activeSeat.id}:roll:${turnDeadlineAt}`;
        void recoverTimedOutRoll(recoveryKey, { source: 'page-resume' });
      }
      const stalledResolution = getStalledTurnSyncResolution();
      if (stalledResolution.status === 'recoverable') void recoverStalledTurnMove(stalledResolution.recoveryKey, { source: 'page-resume' });
    };
    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    document.addEventListener('visibilitychange', handleResume);
    return () => {
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [activeRoomId, activeSeat, roll, screen, stalledTurnWatchKey, turnDeadlineAt, turnDeadlineKind, turnIndex]);


  useEffect(() => () => {
    remoteActionRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    remoteActionRetryTimersRef.current.clear();
    if (rollAnimationTimerRef.current !== null) window.clearTimeout(rollAnimationTimerRef.current);
  }, []);

  useEffect(() => {
    currentRollRef.current = roll;
  }, [roll]);

  useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);

  useEffect(() => {
    if (!rollInProgress || roll || !rollInProgressStartedAtRef.current) return undefined;
    const timer = window.setTimeout(() => {
      if (currentRollRef.current || !rollInProgressRef.current) return;
      rollInProgressRef.current = false;
      rollInProgressStartedAtRef.current = 0;
      clearPendingLocalRemoteActions();
      setRollInProgress(false);
    }, ROLL_STUCK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [roll, rollInProgress]);

  const clearRoll = () => {
    currentRollRef.current = null;
    rollInProgressRef.current = false;
    rollInProgressStartedAtRef.current = 0;
    if (rollAnimationTimerRef.current) {
      window.clearTimeout(rollAnimationTimerRef.current);
      rollAnimationTimerRef.current = null;
    }
    setRollAnimation(null);
    setRollInProgress(false);
    setRoll(null);
    setRollResultReadyAt(0);
  };

  useEffect(() => {
    const previousActiveRoomId = activeRoomIdRef.current;
    activeRoomIdRef.current = activeRoomId;
    activeRoomHostIdRef.current = '';
    lastAppliedStateVersionRef.current = 0;
    lastAppliedSequenceRef.current = 0;
    setAuthoritativeGameStateReady(false);
    processingActionIdsRef.current.clear();
    completedActionIdsRef.current.clear();
    processedClientActionIdsRef.current.clear();
    localActionCommitQueueRef.current = Promise.resolve();
    rollInProgressRef.current = false;
    rollInProgressStartedAtRef.current = 0;
    setRollInProgress(false);
    moveInProgressRef.current = false;
    sequenceReplayInProgressRef.current = false;
    queuedSyncedStateRef.current = null;
    currentRollRef.current = null;
    lastAnimatedRollKeyRef.current = '';
    pendingSequenceMetaRef.current = null;
    clearPendingLocalRemoteActions();
    localClientMutationIdsRef.current.clear();
    lastSavedStateFingerprintRef.current = '';
    savingStateFingerprintRef.current = '';
    setCoordinatorStateSaveKey('');
    setTurnActionTimeoutPenaltyBySeatId({});
    setWaitingForPlayersReady(false);
    setTurnDeadlineAt(0);
    setTurnDeadlineKind('');
    setStartRequestVersion(0);
    setStartCountdownStartsAt(0);
    setStartCountdownEndsAt(0);
    setStartStatus('idle');
    enteredGamePresenceKeyRef.current = '';
    startedGameRequestVersionsRef.current.clear();
    timeoutRecoveryKeysRef.current.clear();
    if (rollAnimationTimerRef.current !== null) {
      window.clearTimeout(rollAnimationTimerRef.current);
      rollAnimationTimerRef.current = null;
    }
    setRollAnimation(null);
    if (activeRoomId) window.localStorage.setItem(STORAGE_KEYS.activeRoomId, activeRoomId);
    else if (previousActiveRoomId) window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
  }, [activeRoomId, currentUser]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.isRoomHost, String(isRoomHost)); }, [isRoomHost]);

  useEffect(() => {
    if (screen !== 'game' || !isRoomHost) return;
    setIsRoomHost(false);
    window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
  }, [isRoomHost, screen]);

  useEffect(() => {
    let mounted = true;
    const applyUser = (nextUser: User | null) => { if (mounted) rememberUser(nextUser); };
    const unsubscribe = listenAuthState(applyUser);
    signInAsGuest()
      .then((nextUser) => {
        if (!nextUser) return;
        applyUser(nextUser);
      })
      .catch((error) => setMessage(error.message));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);


  useEffect(() => {
    if (!currentUser || activeRoomId) return;
    const storedRoomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId);
    if (!storedRoomId) return;
    let cancelled = false;
    setLoadingMessage('참여 중이던 방을 확인하고 있습니다...');
    void (async () => {
      try {
        const storedRoom = await getRoom(storedRoomId);
        if (cancelled) return;
        if (!storedRoom || storedRoom.status === 'finished') {
          window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
          window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
          setLoadingMessage('');
          setMessage('이전에 참여했던 방이 없어져 대기화면으로 돌아왔습니다.');
          return;
        }

        const restoredAsHost = storedRoom.hostId === currentUser.uid;
        const restoredMaxPlayers = storedRoom.maxPlayers as 2 | 3 | 4;
        const joinResult = restoredAsHost ? null : await joinRoom(storedRoom.id, { userId: currentUser.uid, nickname, playMode: storedRoom.playMode });
        if (restoredAsHost) {
          await updateRoomPlayer(storedRoom.id, currentUser.uid, { nickname, ready: true, color: 'red', seatIndex: 0, team: '청팀', isSpectator: false });
        }
        if (cancelled) return;

        setActiveRoomId(storedRoom.id);
        setIsRoomHost(restoredAsHost);
        setActiveRoomTitle(storedRoom.title);
        setActiveRoomHostId(storedRoom.hostId ?? '');
        setPlayMode(storedRoom.playMode);
        setMaxPlayers(restoredMaxPlayers);
        setItemMode(storedRoom.itemMode);
        setStackedRollMode(Boolean(storedRoom.stackedRollMode));
        setPieceCount(storedRoom.pieceCount ?? 4);
        if (joinResult?.role === 'player') {
          setSeats(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
        } else if (restoredAsHost) {
          setSeats(createSeats(nickname, storedRoom.playMode, restoredMaxPlayers).map((seat) => seat.isHost ? { ...seat, id: currentUser.uid } : seat));
        }
        setScreen(isRoomInGame(storedRoom) ? 'game' : 'waitingRoom');
        setLoadingMessage('');
        setMessage('참여 중이던 방에 다시 입장했습니다.');
      } catch (error) {
        if (cancelled) return;
        window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
        window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
        hostingRoomUserIdRef.current = '';
        setActiveRoomId('');
        setIsRoomHost(false);
        setActiveRoomTitle('');
        setScreen('lobby');
        setLoadingMessage('');
        setMessage(error instanceof Error ? error.message : '이전 방 복구에 실패했습니다. 다시 참가해주세요.');
      }
    })();
    return () => { cancelled = true; };
  }, [activeRoomId, currentUser, nickname]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.nickname, nickname);
  }, [nickname]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.title, title);
  }, [title]);

  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.playMode, playMode); }, [playMode]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.maxPlayers, String(maxPlayers)); }, [maxPlayers]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.itemMode, String(itemMode)); }, [itemMode]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.stackedRollMode, String(stackedRollMode)); }, [stackedRollMode]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.pieceCount, String(pieceCount)); }, [pieceCount]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.soundEnabled, String(soundEnabled)); }, [soundEnabled]);

  useRoomPresence(activeRoomId, localSeatId);

  useEffect(() => {
    if (!winner) { lastWinnerSoundRef.current = ''; return; }
    if (lastWinnerSoundRef.current === winner) return;
    lastWinnerSoundRef.current = winner;
    playSoundEffect('win', soundEnabled);
  }, [soundEnabled, winner]);

  useEffect(() => {
    if (!activeRoomId) return undefined;
    const subscribedRoomId = activeRoomId;
    return subscribeRoom(subscribedRoomId, (room: RoomSummary | null) => {
      if (activeRoomIdRef.current !== subscribedRoomId) return;
      if (!room) {
        hostingRoomUserIdRef.current = '';
        activeRoomHostIdRef.current = '';
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setActiveRoomHostId('');
        setIsRoomHost(false);
        setCountdown(-1);
        setItemPromptTiming(null);
        setTurnOrderIntro(null);
        setMessage('방이 종료되어 대기실로 이동했습니다.');
        return;
      }
      const nextHostId = room.hostId ?? '';
      const hostUserId = (userRef.current ?? currentUser)?.uid ?? hostingRoomUserIdRef.current;
      activeRoomHostIdRef.current = nextHostId;
      setActiveRoomTitle(room.title);
      setActiveRoomHostId(nextHostId);
      setPlayMode(room.playMode);
      setMaxPlayers(room.maxPlayers as 2 | 3 | 4);
      setItemMode(room.itemMode);
      setStackedRollMode(Boolean(room.stackedRollMode));
      setPieceCount(room.pieceCount ?? 4);
      setIsRoomHost((previousIsRoomHost) => hostUserId ? room.hostId === hostUserId : previousIsRoomHost);
      const nextStartVersion = Number(room.startRequestVersion ?? 0);
      const nextCountdownStartsAt = Number(room.startCountdownStartsAt ?? 0);
      const nextCountdownEndsAt = Number(room.startCountdownEndsAt ?? room.startCountdownUntil ?? 0);
      const nextStartStatus = room.startStatus ?? (nextCountdownEndsAt > Date.now() ? 'requested' : 'idle');
      setStartRequestVersion(nextStartVersion);
      setStartCountdownStartsAt(nextCountdownStartsAt);
      setStartCountdownEndsAt(nextCountdownEndsAt);
      setStartStatus(nextStartStatus);
      if (nextStartStatus === 'requested' && nextCountdownEndsAt > Date.now()) {
        const now = Date.now();
        setCountdown(now >= nextCountdownStartsAt ? Math.max(1, Math.ceil((nextCountdownEndsAt - now) / 1000)) : -1);
      }
      else if (countdown >= 0) setCountdown(-1);
      const roomCurrentlyInGame = isRoomInGame(room);
      if (roomCurrentlyInGame) setScreen('game');
      const startFlowStillActive = nextStartStatus === 'requested' || nextStartStatus === 'entering';
      if (!roomCurrentlyInGame && room.status === 'waiting' && screen === 'game' && !winner && !startFlowStillActive) {
        setScreen('waitingRoom');
        setCountdown(-1);
        setItemPromptTiming(null);
        setTurnOrderIntro(null);
        setEndGameDialogOpen(false);
        setMessage('게임이 종료되어 방 대기실로 돌아왔습니다.');
      }
      if (room.status === 'finished') {
        hostingRoomUserIdRef.current = '';
        activeRoomHostIdRef.current = '';
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setActiveRoomHostId('');
        setIsRoomHost(false);
        setCountdown(-1);
        setItemPromptTiming(null);
        setTurnOrderIntro(null);
        setEndGameDialogOpen(false);
        setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.');
      }
    });
  }, [activeRoomId, currentUserId, countdown, screen, winner]);


  useEffect(() => {
    if (!activeRoomId) return undefined;
    spectatorIdsRef.current = new Set();
    roomPlayerAiStatesRef.current = new Map();
    return subscribeRoomPlayers(activeRoomId, (players) => {
      const nextSeats = seatsFromRoomPlayers(players, playMode, maxPlayers, activeRoomHostId);
      const currentUserId = (userRef.current ?? currentUser)?.uid;
      const hasCurrentUserInSnapshot = Boolean(currentUserId && players.some((player) => player.id === currentUserId && !player.isSpectator));
      if (hasCurrentUserInSnapshot) confirmedRoomPlayerRef.current = true;
      if (currentUserId && !leavingRoomRef.current && !isRoomManager && screen === 'waitingRoom' && confirmedRoomPlayerRef.current && !hasCurrentUserInSnapshot) {
        confirmedRoomPlayerRef.current = false;
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setIsRoomHost(false);
        setCountdown(-1);
        setMessage('방장에게 강퇴당했습니다.');
        setRoomNoticeDialog({ title: '방장에게 강퇴당했습니다.', message: '로비로 이동했습니다.' });
        return;
      }
      players.forEach((player) => {
        if (player.isAI) pendingAiSeatIdsRef.current.delete(player.id);
      });
      setSeats((currentSeats) => {
        const seatsWithPendingAI = nextSeats.map((nextSeat) => {
          if (!pendingAiSeatIdsRef.current.has(nextSeat.id) || !nextSeat.isEmpty) return nextSeat;
          const optimisticAISeat = currentSeats.find((seat) => seat.id === nextSeat.id && seat.isAI);
          return optimisticAISeat ? { ...nextSeat, ...optimisticAISeat, isEmpty: false, ready: true, isAI: true } : nextSeat;
        });
        if (screen === 'game') return preserveLockedGameSeats(currentSeats, seatsWithPendingAI);
        if (!currentUserId || isRoomManager || screen !== 'waitingRoom' || hasCurrentUserInSnapshot) return seatsWithPendingAI;
        if (seatsWithPendingAI.some((seat) => seat.id === currentUserId && !seat.isEmpty && !seat.isAI)) return seatsWithPendingAI;
        const optimisticSeat = currentSeats.find((seat) => seat.id === currentUserId && !seat.isEmpty && !seat.isAI);
        if (!optimisticSeat) return seatsWithPendingAI;
        return seatsWithPendingAI.map((seat) => seat.label === optimisticSeat.label ? { ...seat, ...optimisticSeat, isHost: false, isEmpty: false } : seat);
      });
      const nextSpectators = spectatorsFromRoomPlayers(players);
      if (canCoordinateOnlineGame && screen === 'game') {
        const previousIds = spectatorIdsRef.current;
        const previousAiStates = roomPlayerAiStatesRef.current;
        const systemLogTexts: string[] = [];
        nextSpectators.forEach((spectator) => {
          if (!previousIds.has(spectator.id)) systemLogTexts.push(`${spectator.name}님이 관전자로 입장했습니다.`);
        });
        players.forEach((player) => {
          if (player.isSpectator) return;
          const previous = previousAiStates.get(player.id);
          if (!previous || previous.isSpectator) return;
          if (!previous.isAI && player.isAI) systemLogTexts.push(`${previous.nickname || player.nickname}님이 나갔습니다. AI가 이어서 플레이합니다.`);
          if (previous.isAI && !player.isAI) systemLogTexts.push(`${player.nickname}님이 돌아왔습니다. 다시 유저가 플레이합니다.`);
        });
        if (systemLogTexts.length) {
          addLogs(systemLogTexts);
          pendingSequenceMetaRef.current = {
            type: 'state_snapshot',
            actorId: localSeatId,
            clientMutationId: `player_presence:${activeRoomId}:${Date.now()}`,
            payload: { event: 'player_presence_changed', count: systemLogTexts.length },
          };
          setCoordinatorStateSaveKey((current) => current || `player_presence:${activeRoomId}:${Date.now()}`);
        }
      }
      spectatorIdsRef.current = new Set(nextSpectators.map((spectator) => spectator.id));
      roomPlayerAiStatesRef.current = new Map(players.map((player) => [player.id, { isAI: Boolean(player.isAI), isSpectator: Boolean(player.isSpectator), nickname: player.nickname }]));
      setSpectators(nextSpectators);
      if (!players.length) void scheduleEmptyRoomDeletion(activeRoomId);
    });
  }, [activeRoomHostId, activeRoomId, canCoordinateOnlineGame, currentUserId, isRoomManager, localSeatId, maxPlayers, playMode, screen]);

  function isLocalSyncedMutation(clientMutationId: unknown) {
    return typeof clientMutationId === 'string' && localClientMutationIdsRef.current.has(clientMutationId);
  }

  function playSyncedRollSoundOnce(result: YutResult, soundKey: string, clientMutationId?: unknown) {
    if (!soundKey || isLocalSyncedMutation(clientMutationId) || lastSyncedRollSoundKeyRef.current === soundKey) return;
    lastSyncedRollSoundKeyRef.current = soundKey;
    playSfx('roll');
    if (result.bonus) window.setTimeout(() => playSfx('bonus'), 420);
  }

  function playSyncedMoveSoundOnce(soundKey: string, clientMutationId?: unknown) {
    if (!soundKey || isLocalSyncedMutation(clientMutationId) || playedSyncedMoveSoundKeysRef.current.has(soundKey)) return false;
    playedSyncedMoveSoundKeysRef.current.add(soundKey);
    if (playedSyncedMoveSoundKeysRef.current.size > 160) playedSyncedMoveSoundKeysRef.current = new Set(Array.from(playedSyncedMoveSoundKeysRef.current).slice(-80));
    playSfx('move');
    return true;
  }

  function playSyncedEffectSoundOnce(state: SequenceStateSnapshot, clientMutationId?: unknown) {
    if (isLocalSyncedMutation(clientMutationId)) return;
    const captureEffectId = state.captureEffect?.id;
    if (captureEffectId && lastSyncedCaptureSoundKeyRef.current !== String(captureEffectId)) {
      lastSyncedCaptureSoundKeyRef.current = String(captureEffectId);
      playSfx('capture');
    }
    const trapEffectId = state.trapEffect?.id;
    if (trapEffectId && lastSyncedTrapSoundKeyRef.current !== String(trapEffectId)) {
      lastSyncedTrapSoundKeyRef.current = String(trapEffectId);
      playSfx('trap');
    }
  }

  async function animateSyncedPieceMove(previousPieces: BoardPiece[], finalPieces: BoardPiece[], movedPieceIds: string[], steps: number, syncedBranchChoice: BranchChoice, soundKey = '', clientMutationId?: unknown) {
    if (!movedPieceIds.length || moveInProgressRef.current) return false;
    const anchorBefore = previousPieces.find((piece) => piece.id === movedPieceIds[0]);
    const anchorAfter = finalPieces.find((piece) => piece.id === movedPieceIds[0]);
    if (!anchorBefore || !anchorAfter || anchorBefore.nodeId === anchorAfter.nodeId) return false;
    setMoveInProgressState(true);
    setMovingPieceId(anchorBefore.id);
    const movePathNodeIds = getMovePathNodeIdsWithPrevious(anchorBefore.nodeId, steps, getEffectiveBranchChoice(anchorBefore.nodeId, syncedBranchChoice), anchorBefore.previousNodeId);
    const animatedPieces = previousPieces.map((piece) => movedPieceIds.includes(piece.id) ? { ...piece, started: true, finished: false } : piece);
    setPieces(animatedPieces);
    let currentNodeId = anchorBefore.nodeId;
    for (const nextNodeId of movePathNodeIds) {
      if (!nextNodeId) break;
      currentNodeId = nextNodeId;
      const nextNodeIndex = Math.max(0, BOARD_NODES.findIndex((node) => node.id === currentNodeId));
      setPieces((currentPieces) => currentPieces.map((piece) => movedPieceIds.includes(piece.id) ? { ...piece, nodeId: currentNodeId, nodeIndex: nextNodeIndex, started: true, finished: false } : piece));
      playSyncedMoveSoundOnce(`${soundKey}:${currentNodeId}`, clientMutationId);
      await delay(STEP_DELAY_MS);
      if (currentNodeId === anchorAfter.nodeId) break;
    }
    setPieces(finalPieces);
    setMovingPieceId('');
    setMoveInProgressState(false);
    return true;
  }

  function playRollAnimationOnce(result: YutResult, sticks: YutStick[], key: string, turnOrder = false, fallCount = 0, timingZone?: RollTimingZone | null) {
    if (lastAnimatedRollKeyRef.current === key) return;
    lastAnimatedRollKeyRef.current = key;
    if (rollAnimationTimerRef.current !== null) window.clearTimeout(rollAnimationTimerRef.current);
    setRollAnimation({ id: Date.now(), result, sticks, turnOrder, fallCount, timingZone: timingZone ?? undefined });
    rollAnimationTimerRef.current = window.setTimeout(() => {
      setRollAnimation(null);
      rollAnimationTimerRef.current = null;
    }, turnOrder ? TURN_ORDER_ROLL_ANIMATION_MS : ROLL_ANIMATION_MS);
  }

  const applySyncedStateSnapshot = (state: SequenceStateSnapshot, options: { allowMoveAnimation?: boolean; allowRollAnimation?: boolean; updateVersion?: boolean; updateSequence?: boolean } = {}) => {
    const { allowMoveAnimation = true, allowRollAnimation = true, updateVersion = true, updateSequence = true } = options;
    const stateVersion = Number('turnVersion' in state ? state.turnVersion ?? 0 : 0);
    if (updateVersion && stateVersion) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, stateVersion);
    if (updateSequence && 'lastSequence' in state) lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, Number(state.lastSequence ?? 0));
    if (activeRoomId && screen === 'game' && (stateVersion > 0 || Number((state as { lastSequence?: unknown }).lastSequence ?? 0) > 0)) setAuthoritativeGameStateReady(true);
    const nextRoll = (state.roll as YutResult | null | undefined) ?? null;
    const syncedGameSeats = (state.gameSeats as GameSeatSnapshot[] | undefined) ?? [];
    if (syncedGameSeats.length) setSeats((currentSeats) => preserveLockedGameSeats(currentSeats, seatsFromGameSeatSnapshots(syncedGameSeats, playMode, maxPlayers)));
    const lastClientMutationId = (state as { lastClientMutationId?: unknown }).lastClientMutationId;
    const previousRoll = currentRollRef.current;
    const syncedPieces = (state.pieces as BoardPiece[] | undefined) ?? piecesRef.current;
    const syncedLastMovedPieceIds = (state.lastMovedPieceIds as string[] | undefined) ?? [];
    const syncedBranchChoice = (state.branchChoice as BranchChoice | undefined) ?? 'outer';
    const shouldAnimateSyncedMove = Boolean(allowMoveAnimation && !nextRoll && previousRoll && syncedLastMovedPieceIds.length && !moveInProgressRef.current && piecesRef.current.some((piece) => syncedLastMovedPieceIds.includes(piece.id) && syncedPieces.some((nextPiece) => nextPiece.id === piece.id && nextPiece.nodeId !== piece.nodeId)));
    const syncedRollResultReadyAt = Number(state.rollResultReadyAt ?? 0);
    const nextRollResultReadyAt = normalizeRollResultReadyAt(syncedRollResultReadyAt);
    const nextTurnIndex = Number(state.turnIndex ?? 0);
    if (allowRollAnimation && nextRoll && !currentRollRef.current) {
      const snapshotSequence = Number((state as { lastSequence?: unknown }).lastSequence ?? 0);
      const snapshotMutationId = typeof lastClientMutationId === 'string' ? lastClientMutationId : '';
      const animationKey = snapshotSequence > 0 || snapshotMutationId
        ? `snapshot-roll:${snapshotSequence}:${snapshotMutationId}:${nextRoll.name}:${nextRoll.steps}:${nextRollResultReadyAt}`
        : `snapshot-roll:${nextTurnIndex}:${nextRoll.name}:${nextRoll.steps}:${nextRollResultReadyAt}`;
      playRollAnimationOnce(nextRoll, makeDisplaySticks(nextRoll), animationKey, false, 0, (state.lastRollTimingZone as RollTimingZone | null | undefined) ?? undefined);
      playSyncedRollSoundOnce(nextRoll, animationKey, lastClientMutationId);
    }
    currentRollRef.current = nextRoll;
    if (shouldAnimateSyncedMove && previousRoll) void animateSyncedPieceMove(piecesRef.current, syncedPieces, syncedLastMovedPieceIds, previousRoll.steps, syncedBranchChoice, `snapshot:${stateVersion}:${Number(state.lastSequence ?? 0)}`, lastClientMutationId);
    else setPieces(syncedPieces);
    setTurnIndex(nextTurnIndex);
    setRoll(nextRoll);
    setRollStack(((state.rollStack as YutResult[] | undefined) ?? []));
    setSelectedRollStackIndex(typeof state.selectedRollStackIndex === 'number' ? state.selectedRollStackIndex : null);
    setRollStackClosed(Boolean(state.rollStackClosed));
    if (state.boardItems) setBoardItems(state.boardItems);
    if (state.ownedItems) setOwnedItems(state.ownedItems as Record<string, ItemType[]>);
    if (state.trapNodes) setTrapNodes(state.trapNodes as TrapNode[]);
    setPendingTrapPlacement((state.pendingTrapPlacement as PendingTrapPlacement | null | undefined) ?? null);
    if (state.shieldedPieceIds) setShieldedPieceIds(state.shieldedPieceIds);
    if (state.logs) {
      const nextLogs = state.logs as GameLog[];
      logIdRef.current = Math.max(logIdRef.current, ...nextLogs.map((log) => Number(log.id) || 0));
      setLogs(nextLogs);
    }
    const syncedCaptureEffect = (state.captureEffect as CaptureEffect | null | undefined) ?? null;
    setCaptureEffect(nextTurnIndex !== turnIndexRef.current ? null : syncedCaptureEffect);
    setTrapEffect((state.trapEffect as TrapEffect | null | undefined) ?? null);
    setFallEffect((state.fallEffect as FallEffect | null | undefined) ?? null);
    setLastRollTimingZone((state.lastRollTimingZone as RollTimingZone | null | undefined) ?? null);
    playSyncedEffectSoundOnce(state, lastClientMutationId);
    setGameStartedAt((state.gameStartedAt as number | null | undefined) ?? null);
    setTurnOrderIds((state.turnOrderIds as string[] | undefined) ?? []);
    setInitialTurnOrderIds((state.initialTurnOrderIds as string[] | undefined) ?? []);
    setCompletedSeatIds((state.completedSeatIds as string[] | undefined) ?? []);
    setRankingSeatIds((state.rankingSeatIds as string[] | undefined) ?? []);
    setGameEndMode((state.gameEndMode as 'partial_finish' | 'final' | '' | undefined) ?? '');
    setLastFinishedSeatId(String(state.lastFinishedSeatId ?? ''));
    setAuthoritativeWinner(String(state.winner ?? ''));
    setContinuationRound(Number(state.continuationRound ?? 0));
    setTurnOrderIntro((state.turnOrderIntro as TurnOrderIntro | null | undefined) ?? null);
    setRollLockUntil(Number(state.rollLockUntil ?? 0));
    setLastMovedPieceIds((state.lastMovedPieceIds as string[] | undefined) ?? []);
    setLastMovedSeatId(state.lastMovedSeatId ?? '');
    setItemPromptTiming((state.itemPromptTiming as ItemTiming | null | undefined) ?? null);
    setBranchChoice((state.branchChoice as BranchChoice | undefined) ?? 'outer');
    setRollResultReadyAt(nextRollResultReadyAt);
    setTurnOrderPhase((state.turnOrderPhase as TurnOrderPhase | null | undefined) ?? { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 });
    setWaitingForPlayersReady(Boolean(state.waitingForPlayersReady));
    setTurnDeadlineAt(Number(state.turnDeadlineAt ?? 0));
    setTurnDeadlineKind((state.turnDeadlineKind as typeof turnDeadlineKind | undefined) ?? '');
    if (typeof state.startRequestVersion === 'number') setStartRequestVersion(Number(state.startRequestVersion));
    lastSavedStateFingerprintRef.current = makeGameStateFingerprint({
      pieces: syncedPieces,
      turnIndex: nextTurnIndex,
      turnOrderIds: (state.turnOrderIds as string[] | undefined) ?? [],
      initialTurnOrderIds: (state.initialTurnOrderIds as string[] | undefined) ?? [],
      completedSeatIds: (state.completedSeatIds as string[] | undefined) ?? [],
      rankingSeatIds: (state.rankingSeatIds as string[] | undefined) ?? [],
      gameEndMode: (state.gameEndMode as 'partial_finish' | 'final' | '' | undefined) ?? '',
      lastFinishedSeatId: String(state.lastFinishedSeatId ?? ''),
      continuationRound: Number(state.continuationRound ?? 0),
      roll: nextRoll,
      rollStack: (state.rollStack as YutResult[] | undefined) ?? [],
      selectedRollStackIndex: typeof state.selectedRollStackIndex === 'number' ? state.selectedRollStackIndex : null,
      rollStackClosed: Boolean(state.rollStackClosed),
      boardItems: (state.boardItems as BoardItem[] | undefined) ?? [],
      ownedItems: (state.ownedItems as Record<string, ItemType[]> | undefined) ?? {},
      trapNodes: (state.trapNodes as TrapNode[] | undefined) ?? [],
      shieldedPieceIds: (state.shieldedPieceIds as string[] | undefined) ?? [],
      winner: String(state.winner ?? ''),
      gameStartedAt: (state.gameStartedAt as number | null | undefined) ?? null,
      turnOrderIntro: (state.turnOrderIntro as TurnOrderIntro | null | undefined) ?? null,
      pendingTrapPlacement: (state.pendingTrapPlacement as PendingTrapPlacement | null | undefined) ?? null,
      rollLockUntil: Number(state.rollLockUntil ?? 0),
      lastMovedPieceIds: syncedLastMovedPieceIds,
      lastMovedSeatId: String(state.lastMovedSeatId ?? ''),
      effectiveRollResultReadyAt: nextRollResultReadyAt,
      turnOrderPhase: (state.turnOrderPhase as TurnOrderPhase | null | undefined) ?? { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 },
      waitingForPlayersReady: Boolean(state.waitingForPlayersReady),
      turnDeadlineAt: Number(state.turnDeadlineAt ?? 0),
      turnDeadlineKind: (state.turnDeadlineKind as typeof turnDeadlineKind | undefined) ?? '',
      startRequestVersion: Number(state.startRequestVersion ?? 0),
      fallEffect: (state.fallEffect as FallEffect | null | undefined) ?? null,
    });
    rollInProgressRef.current = false;
    rollInProgressStartedAtRef.current = 0;
    setRollInProgress(false);
    acknowledgePendingLocalRemoteAction(lastClientMutationId);
  };

  async function waitForCurrentMoveToFinish(maxWaitMs: number) {
    const startedAt = Date.now();
    while (moveInProgressRef.current && Date.now() - startedAt < maxWaitMs) {
      await delay(STEP_DELAY_MS);
    }
    return !moveInProgressRef.current;
  }

  async function replayMoveSequence(sequence: GameSequence) {
    const payload = sequence.payload ?? {};
    const finalPieces = (sequence.stateAfter?.pieces as BoardPiece[] | undefined) ?? null;
    const movingGroupIds = Array.isArray(payload.movingGroupIds) ? payload.movingGroupIds.map(String) : [];
    const pathNodeIds = Array.isArray(payload.pathNodeIds) ? payload.pathNodeIds.map(String).filter(Boolean) : [];
    if (!finalPieces || !movingGroupIds.length || !pathNodeIds.length) {
      if (finalPieces) setPieces(finalPieces);
      return;
    }
    if (moveInProgressRef.current) {
      const moveFinished = await waitForCurrentMoveToFinish((pathNodeIds.length + 6) * STEP_DELAY_MS);
      if (!moveFinished) {
        setPieces(finalPieces);
        return;
      }
    }
    const anchorBefore = piecesRef.current.find((piece) => piece.id === movingGroupIds[0]);
    const anchorAfter = finalPieces.find((piece) => piece.id === movingGroupIds[0]);
    if (!anchorBefore || !anchorAfter || anchorBefore.nodeId === anchorAfter.nodeId) {
      setPieces(finalPieces);
      return;
    }
    setMoveInProgressState(true);
    setMovingPieceId(anchorBefore.id);
    setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, started: true, finished: false } : piece));
    for (const nextNodeId of pathNodeIds) {
      const nextNodeIndex = Math.max(0, BOARD_NODES.findIndex((node) => node.id === nextNodeId));
      setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeId: nextNodeId, nodeIndex: nextNodeIndex, started: nextNodeId !== 'finish', finished: nextNodeId === 'finish' } : piece));
      playSyncedMoveSoundOnce(`sequence:${sequence.sequence}:${nextNodeId}`, sequence.clientMutationId);
      await delay(STEP_DELAY_MS);
      if (nextNodeId === anchorAfter.nodeId) break;
    }
    setPieces(finalPieces);
    const itemEvent = payload.itemEvent;
    if (itemEvent && typeof itemEvent === 'object') showItemPickupEffect(itemEvent as Record<string, unknown>, `sequence:${sequence.sequence}:item`);
    setMovingPieceId('');
    setMoveInProgressState(false);
  }

  async function replayRollSequence(sequence: GameSequence) {
    const stateAfter = sequence.stateAfter as SequenceStateSnapshot | undefined;
    const sequenceRoll = (stateAfter?.roll as YutResult | null | undefined) ?? null;
    if (!sequenceRoll) {
      if (stateAfter) applySyncedStateSnapshot(stateAfter, { allowMoveAnimation: false, allowRollAnimation: false, updateVersion: false, updateSequence: false });
      return;
    }
    const clientMutationId = typeof sequence.clientMutationId === 'string' ? sequence.clientMutationId : '';
    const isLocalOptimisticRoll = Boolean(clientMutationId && localClientMutationIdsRef.current.has(clientMutationId));
    if (!isLocalOptimisticRoll) {
      const readyAt = normalizeRollResultReadyAt(Number(stateAfter?.rollResultReadyAt ?? 0));
      const animationKey = `sequence-roll:${Number(sequence.sequence ?? 0)}:${clientMutationId}:${sequenceRoll.name}:${sequenceRoll.steps}:${readyAt}`;
      playRollAnimationOnce(sequenceRoll, makeDisplaySticks(sequenceRoll), animationKey, false, 0, (stateAfter?.lastRollTimingZone as RollTimingZone | null | undefined) ?? undefined);
      playSyncedRollSoundOnce(sequenceRoll, animationKey, clientMutationId);
    }
    if (stateAfter) applySyncedStateSnapshot(stateAfter, { allowMoveAnimation: false, allowRollAnimation: false, updateVersion: false, updateSequence: false });
  }

  async function replayMissingSequencesThenApply(finalState: SequenceStateSnapshot, localSequence: number, remoteSequence: number) {
    const shouldApplyLatestSnapshotWithoutReplay = onlineGameRole === 'spectator' || localSequence <= 0;
    if (shouldApplyLatestSnapshotWithoutReplay) {
      applySyncedStateSnapshot(finalState, { allowMoveAnimation: false, updateVersion: true, updateSequence: true });
      return;
    }
    if (!activeRoomId || sequenceReplayInProgressRef.current) {
      queuedSyncedStateRef.current = finalState;
      return;
    }
    sequenceReplayInProgressRef.current = true;
    try {
      const sequences = (await getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence)))
        .filter((sequence) => Number(sequence.sequence ?? 0) > lastAppliedSequenceRef.current && Number(sequence.sequence ?? 0) <= remoteSequence)
        .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
      for (const sequence of sequences) {
        const sequenceNumber = Number(sequence.sequence ?? 0);
        if (!sequenceNumber || sequenceNumber <= lastAppliedSequenceRef.current) continue;
        if (sequence.type === 'roll_yut') await replayRollSequence(sequence);
        else if (sequence.type === 'move_piece_resolved') await replayMoveSequence(sequence);
        else if (sequence.stateAfter) applySyncedStateSnapshot(sequence.stateAfter as SequenceStateSnapshot, { allowMoveAnimation: false, allowRollAnimation: false, updateVersion: false, updateSequence: false });
        acknowledgePendingLocalRemoteAction(sequence.clientMutationId);
        lastAppliedSequenceRef.current = sequenceNumber;
      }
      applySyncedStateSnapshot(finalState, { allowMoveAnimation: false, allowRollAnimation: false, updateVersion: true, updateSequence: true });
    } catch {
      applySyncedStateSnapshot(finalState, { allowMoveAnimation: false, allowRollAnimation: true, updateVersion: true, updateSequence: true });
    } finally {
      sequenceReplayInProgressRef.current = false;
      const queuedState = queuedSyncedStateRef.current;
      queuedSyncedStateRef.current = null;
      const queuedSequence = Number(queuedState?.lastSequence ?? 0);
      if (queuedState && queuedSequence > lastAppliedSequenceRef.current) void replayMissingSequencesThenApply(queuedState, lastAppliedSequenceRef.current, queuedSequence);
    }
  }

  async function reconcilePendingLocalRemoteActions(options: { forceStaleClear?: boolean } = {}) {
    if (!activeRoomId || !pendingLocalRemoteActionsRef.current.size) return false;
    const now = Date.now();
    let changed = false;
    const pendingEntries = Array.from(pendingLocalRemoteActionsRef.current).map((actionKey) => ({
      actionKey,
      meta: pendingLocalRemoteActionMetaRef.current.get(actionKey),
    }));
    for (const { actionKey, meta } of pendingEntries) {
      const processedAction = await measureFirebaseLatency(() => getProcessedGameAction(activeRoomId, actionKey));
      if (processedAction?.sequence) {
        const localSequence = lastAppliedSequenceRef.current;
        if (processedAction.sequence > localSequence) {
          const sequences = await measureFirebaseLatency(() => getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence)));
          const latestState = [...sequences]
            .filter((sequence) => Number(sequence.sequence ?? 0) <= processedAction.sequence)
            .reverse()
            .find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
          if (latestState) await replayMissingSequencesThenApply(latestState, localSequence, processedAction.sequence);
        }
        acknowledgePendingLocalRemoteAction(actionKey);
        changed = true;
        continue;
      }
      const ageMs = now - Number(meta?.createdAt ?? now);
      if (options.forceStaleClear || ageMs >= STALE_PENDING_REMOTE_ACTION_MS) {
        deletePendingLocalRemoteAction(actionKey);
        localClientMutationIdsRef.current.delete(actionKey);
        const diagnosticType = (meta?.type ?? getPendingLocalRemoteActionType(actionKey)) === 'roll_yut' ? 'roll_yut' : 'move_piece';
        recordRemoteActionDiagnostic(diagnosticType, 'stale-pending-cleared', '서버에서 처리 내역을 찾지 못해 오래된 요청 잠금을 해제했습니다.', { actionKey });
        changed = true;
      }
    }
    return changed;
  }

  async function syncLatestSequencesFromBadge() {
    if (!activeRoomId || screen !== 'game') {
      setMessage('게임 중인 온라인 방에서만 최신 상태를 동기화할 수 있습니다.');
      return;
    }
    if (manualSequenceSyncing) return;
    const localSequence = lastAppliedSequenceRef.current;
    void showToast('동기화 중...', '최신 게임 상태를 확인하고 있습니다.', '🔄');
    setManualSequenceSyncing(true);
    try {
      const sequences = await measureFirebaseLatency(() => getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence)));
      const orderedSequences = sequences
        .filter((sequence) => Number(sequence.sequence ?? 0) > localSequence)
        .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
      const latestSequence = Math.max(localSequence, ...orderedSequences.map((sequence) => Number(sequence.sequence ?? 0)));
      const latestState = [...orderedSequences].reverse().find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
      if (!orderedSequences.length || latestSequence <= localSequence) {
        const clearedPending = await reconcilePendingLocalRemoteActions({ forceStaleClear: false });
        if (clearedPending) {
          setMessage(`최신 sequence #${lastAppliedSequenceRef.current} 기준으로 오래된 요청 상태를 정리했습니다.`);
          return;
        }
        const stalledResolution = getStalledTurnSyncResolution();
        const manualResolution = { ...stalledResolution, createdAt: Date.now(), localSequence, latestSequence, result: stalledResolution.status } satisfies ManualSyncResolution;
        setLastManualSyncResolution(manualResolution);
        if (stalledResolution.status === 'recoverable') {
          setMessage('최신 상태이지만 현재 턴 이동이 멈춘 것으로 보여 자동 복구를 시도합니다.');
          recordRemoteActionDiagnostic('move_piece', 'manual-sync-stalled-turn-recovery-started', '동기화 중 멈춘 턴을 감지해 자동 복구를 시도합니다.', { actionKey: stalledResolution.recoveryKey });
          await recoverStalledTurnMove(stalledResolution.recoveryKey, { source: 'manual-sync' });
          return;
        }
        if (stalledResolution.status === 'waiting') {
          setMessage(`최신 상태이지만 현재 턴 이동 완료를 기다리는 중입니다. (${Math.ceil(Math.max(0, stalledResolution.recoveryAfterMs - stalledResolution.ageMs) / 1000)}초 후 복구 가능)`);
          return;
        }
        if (stalledResolution.status === 'blocked' && stalledResolution.reason !== 'not-online-player') {
          const blockedMessage = stalledResolution.reason === 'branch-choice-required'
            ? '최신 상태이지만 현재 말이 분기점에 있어 방향 선택이 필요합니다. 자동 복구를 보류했습니다.'
            : stalledResolution.reason === 'no-movable-piece'
              ? '최신 상태이지만 현재 턴의 이동 후보를 찾지 못했습니다. 진단 정보를 복사해주세요.'
              : `최신 상태이지만 자동 복구를 보류했습니다: ${stalledResolution.reason}`;
          setMessage(blockedMessage);
          return;
        }
        if (stalledResolution.status === 'blocked' && stalledResolution.reason === 'not-online-player') {
          setMessage('최신 상태이지만 현재 턴 이동이 아직 완료되지 않았습니다. 플레이어 기기에서 자동 복구를 시도합니다.');
          return;
        }
        setMessage(`이미 최신 상태입니다. (sequence #${localSequence})`);
        return;
      }
      if (!latestState) {
        setMessage(`sequence #${latestSequence}까지 확인했지만 적용할 게임 상태를 찾지 못했습니다.`);
        return;
      }
      await replayMissingSequencesThenApply(latestState, localSequence, latestSequence);
      setMessage(`최신 sequence #${latestSequence}까지 동기화했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '최신 게임 상태 동기화에 실패했습니다.');
    } finally {
      setManualSequenceSyncing(false);
    }
  }

  useGameSyncSubscription({
    activeRoomId,
    lastAppliedSequenceRef,
    lastAppliedStateVersionRef,
    applyingSyncedStateRef,
    replayMissingSequencesThenApply,
    applySyncedStateSnapshot,
  });

  useEffect(() => {
    if (playMode === 'team' && maxPlayers !== 4) setMaxPlayers(4);
  }, [maxPlayers, playMode]);

  useEffect(() => {
    if (!itemPromptTiming) return undefined;
    const timeoutMs = getItemPromptTimeoutMs(localSeatId);
    const timer = window.setTimeout(() => {
      markTurnActionTimedOut(localSeatId);
      setItemPromptTiming(null);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [itemPromptTiming, localSeatId, turnActionTimeoutPenaltyBySeatId]);

  useEffect(() => {
    if (screen !== 'game' || !gameStartedAt) return undefined;
    setPlayTimeNow(Date.now());
    if (winner) return undefined;
    const timer = window.setInterval(() => setPlayTimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [gameStartedAt, screen, winner]);

  useTurnOrderClock({ activeTurnOrderIntro, turnOrderPhase, setTurnOrderClock });
  useTurnOrderPortraitScroll(screen, turnOrderPhase.active);
  useTurnOrderAutoFinish({ playableSeats, turnOrderPhase, finishTurnOrderCeremony });

  useEffect(() => {
    if (!turnOrderIntro) return undefined;
    const now = Date.now();
    const hideDelay = Math.max(0, turnOrderIntro.readyAt - now);
    const readyDelay = hideDelay;
    const hideTimer = window.setTimeout(() => setTurnOrderIntro((current) => current ? { ...current, visible: false } : current), hideDelay);
    const readyTimer = window.setTimeout(() => {
      setTurnOrderIntro(null);
      setGameStartedAt((current) => current ?? Date.now());
    }, readyDelay);
    return () => { window.clearTimeout(hideTimer); window.clearTimeout(readyTimer); };
  }, [turnOrderIntro?.readyAt]);

  useEffect(() => {
    if (!activeRoomId || !canCompleteInitialOnlineTurnOrderIntro || screen !== 'game' || !turnOrderIntro?.readyAt) return undefined;
    const readyAt = turnOrderIntro.readyAt;
    const completeIntro = () => {
      if (completingTurnOrderIntroRef.current.has(readyAt)) return;
      completingTurnOrderIntroRef.current.add(readyAt);
      void completeTurnOrderIntro(activeRoomId, { readyAt, actorId: localSeatId }).then((version) => {
        if (version) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, version);
      }).finally(() => {
        completingTurnOrderIntroRef.current.delete(readyAt);
      });
    };
    const delayMs = Math.max(0, readyAt - Date.now());
    const timer = window.setTimeout(completeIntro, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, canCompleteInitialOnlineTurnOrderIntro, localSeatId, screen, turnOrderIntro?.readyAt]);

  useEffect(() => {
    if (rollLockUntil <= Date.now()) return undefined;
    setRollLockClock(Date.now());
    const timer = window.setInterval(() => setRollLockClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [rollLockUntil]);

  useEffect(() => {
    const nextRollResultReadyAt = normalizeRollResultReadyAt(rollResultReadyAt);
    if (!nextRollResultReadyAt) {
      if (rollResultReadyAt) setRollResultReadyAt(0);
      return undefined;
    }
    setRollLockClock(Date.now());
    const interval = window.setInterval(() => setRollLockClock(Date.now()), 200);
    const timeout = window.setTimeout(() => {
      setRollLockClock(Date.now());
      setRollResultReadyAt(0);
    }, Math.max(0, nextRollResultReadyAt - Date.now()));
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [rollResultReadyAt]);

  useEffect(() => {
    if (screen === 'game' && roll && isMyTurn && !movingPieceId) showItemPrompt('after_roll');
  }, [roll]);

  useEffect(() => {
    if (screen === 'game' && lastMovedSeatId === localSeatId && !movingPieceId) showItemPrompt('after_move');
  }, [lastMovedPieceIds, lastMovedSeatId, localSeatId]);


  useEffect(() => {
    if (screen !== 'game' || !activeSeat || winner || turnOrderPhase.active || activeTurnOrderIntro) {
      lastTurnToastKeyRef.current = '';
      setTurnToast(null);
      return undefined;
    }

    const canShowBonusToast = canRollNow && lastMovedSeatId === activeSeat.id && lastMovedPieceIds.length > 0;
    const canShowTurnToast = (!roll && canRollNow) || Boolean(roll && canRequestMove);
    const nextTurnToast = canShowBonusToast
      ? { key: `bonus:${turnIndex}:${activeSeat.id}:${lastMovedPieceIds.join(',')}`, text: '한 번 더!' }
      : canShowTurnToast
        ? { key: `turn:${turnIndex}:${activeSeat.id}:${roll ? 'move' : 'roll'}`, text: `${getSeatDisplayName(activeSeat)} 차례` }
        : null;

    if (!nextTurnToast) {
      lastTurnToastKeyRef.current = '';
      setTurnToast(null);
      return undefined;
    }

    if (lastTurnToastKeyRef.current !== nextTurnToast.key) {
      lastTurnToastKeyRef.current = nextTurnToast.key;
      setTurnToast({ id: Date.now(), text: nextTurnToast.text });
    }
    const timer = window.setTimeout(() => setTurnToast((current) => current?.text === nextTurnToast.text ? null : current), 3000);
    return () => window.clearTimeout(timer);
  }, [activeSeat?.id, activeSeat?.label, activeSeat?.name, activeTurnOrderIntro, canRequestMove, canRollNow, lastMovedPieceIds, lastMovedSeatId, roll, screen, turnIndex, winner]);

  useEffect(() => {
    turnIndexRef.current = turnIndex;
    rejectedRemoteActionKeysRef.current.clear();
    setCaptureEffect(null);
  }, [turnIndex]);

  useEffect(() => {
    rejectedRemoteActionKeysRef.current.clear();
  }, [roll?.name, roll?.steps]);

  useEffect(() => {
    if (screen !== 'game' || winner || turnOrderPhase.active || activeTurnOrderIntro || itemPromptTiming || !activeSeat || !activeSeat.isAI || isMyTurn || roll || movingPieceId || pendingTrapPlacement) return undefined;
    if (!canCoordinateOnlineGame) return undefined;
    const actionKey = `${activeSeat.id}:${turnIndex}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`;
    if (aiTurnActionKeyRef.current) return undefined;
    const timer = window.setTimeout(() => {
      if (aiTurnActionKeyRef.current) return;
      aiTurnActionKeyRef.current = actionKey;
      void autoPlayTurn(activeSeat, actionKey);
    }, TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, activeSeat, activeTurnOrderIntro, canCoordinateOnlineGame, isMyTurn, itemPromptTiming, lastMovedPieceIds, lastMovedSeatId, movingPieceId, pendingTrapPlacement, pieces, roll, screen, turnIndex, turnOrderPhase.active, winner]);


  useEffect(() => {
    if (!turnOrderPhase.active) return undefined;
    const localSeat = playableSeats.find((seat) => seat.id === localSeatId);
    if (!localSeat || localSeat.isAI || localTurnOrderSeatRolled) return undefined;
    if (activeRoomId) return undefined;
    const delayMs = Math.max(0, turnOrderPhase.deadline - Date.now());
    const timer = window.setTimeout(() => rollForTurnOrder(false, localSeat.id), delayMs);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, localSeatId, localTurnOrderSeatRolled, playableSeats, turnOrderPhase]);

  useEffect(() => {
    if (!turnOrderPhase.active) return undefined;
    if (!canCoordinateOnlineGame) return undefined;
    const timers = playableSeats
      .filter((seat) => seat.isAI && !rolledTurnOrderSeatIds.has(seat.id))
      .map((seat) => window.setTimeout(() => rollForTurnOrder(false, seat.id), Math.max(0, turnOrderPhase.readyAt - Date.now()) + TURN_ORDER_AI_MIN_DELAY_MS + Math.random() * TURN_ORDER_AI_DELAY_SPREAD_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeRoomId, canCoordinateOnlineGame, playableSeats, rolledTurnOrderSeatIds, turnOrderPhase]);


  useEffect(() => {
    if (!turnOrderPhase.active || turnOrderPhase.readyAt > turnOrderClock || turnOrderPhase.deadline <= 0) return;
    if (!canCoordinateOnlineGame) return;
    if (turnOrderClock < turnOrderPhase.deadline) return;
    finishTurnOrderCeremony(turnOrderPhase.rolls);
  }, [activeRoomId, canCoordinateOnlineGame, turnOrderClock, turnOrderPhase]);

  useEffect(() => {
    if (!turnOrderPhase.active || turnOrderPhase.deadline <= 0 || !isTurnOrderFallbackDue) return;
    if (!canCoordinateOnlineGame) return;
    finishTurnOrderCeremony(turnOrderPhase.rolls);
  }, [activeRoomId, canCoordinateOnlineGame, isTurnOrderFallbackDue, turnOrderPhase]);

  useEffect(() => {
    if (!showBottomBranchControls || !selectedBranchControlKey) {
      lastBranchControlKeyRef.current = '';
      return;
    }
    if (lastBranchControlKeyRef.current === selectedBranchControlKey) return;
    lastBranchControlKeyRef.current = selectedBranchControlKey;
    setBranchChoice('shortcut');
  }, [selectedBranchControlKey, showBottomBranchControls]);



  useEffect(() => {
    if (screen !== 'game' || !canRollNow || !activeSeat || activeSeat.id !== localSeatId || roll || rollAnimation) return undefined;
    const timeoutMs = getTurnActionTimeoutMs(activeSeat.id);
    const timer = window.setTimeout(() => {
      if (canRollNow && !currentRollRef.current) {
        markTurnActionTimedOut(activeSeat.id);
        rollYut({ timedOut: true });
      }
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [activeSeat?.id, canRollNow, localSeatId, roll, rollAnimation, screen, turnActionTimeoutPenaltyBySeatId]);

  useEffect(() => {
    if (screen !== 'game' || !canRequestMove || !roll || rollResultHolding || movingPieceId) return undefined;
    const timeoutMs = getTurnActionTimeoutMs(activeSeat?.id ?? localSeatId);
    const timer = window.setTimeout(() => {
      markTurnActionTimedOut(activeSeat?.id ?? localSeatId);
      void moveSelectedPiece(0, { timedOut: true });
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [activeSeat?.id, canRequestMove, localSeatId, movingPieceId, roll, rollResultHolding, screen, selectedPieceId, turnActionTimeoutPenaltyBySeatId]);

  useEffect(() => {
    if (!roll || !activeSeat || !isMyTurn || movingPieceId || winner || rollResultHolding || pendingTrapPlacement) return;
    const steps = roll.steps;
    const movablePieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (steps >= 0 || piece.started));
    if (movablePieces.length === 0) {
      const timer = window.setTimeout(() => {
        if (activeRoomId) {
          void moveSelectedPiece(0, { timedOut: true });
          return;
        }
        addLog(steps < 0 ? `${getSeatDisplayName(activeSeat)}님은 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.` : `${getSeatDisplayName(activeSeat)}님은 이동할 말이 없습니다.`);
        setBranchChoice('outer');
        clearRoll();
        setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
      }, NO_MOVABLE_PIECE_AUTO_PASS_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    const hasPieceOnBoard = pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished);
    const autoMovePiece = !hasPieceOnBoard
      ? [...movablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0]
      : (() => {
          const movableGroups = Array.from(new Map(movablePieces.map((piece) => [piece.started ? piece.nodeId : piece.id, piece])).values());
          return movableGroups.length === 1 ? movableGroups[0] : undefined;
        })();
    if (!autoMovePiece) return;
    const needsBranchChoice = steps > 0 && autoMovePiece.started && BRANCH_NODE_IDS.includes(autoMovePiece.nodeId as typeof BRANCH_NODE_IDS[number]);
    if (needsBranchChoice) return;
    setSelectedPieceId(autoMovePiece.id);
    const timer = window.setTimeout(() => {
      if (activeRoomId) {
        if (!canRequestMove) return;
        void moveSelectedPiece();
      } else {
        void movePiece(autoMovePiece.id, roll, activeSeat);
      }
    }, AUTO_SINGLE_MOVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, activeSeat, canRequestMove, isMyTurn, movingPieceId, pieces, turnSeats.length, roll, winner, rollResultHolding, pendingTrapPlacement]);

  useEffect(() => {
    if (!startCountdownActive) {
      if (countdown >= 0 && startStatus !== 'requested') setCountdown(-1);
      return undefined;
    }
    const updateCountdown = () => {
      const now = Date.now();
      if (now < startCountdownStartsAt) setCountdown(-1);
      else setCountdown(Math.max(0, Math.ceil((startCountdownEndsAt - now) / 1000)));
      if (now >= startCountdownEndsAt) {
        if (activeRoomId) {
          void measureFirebaseLatency(() => markRoomGameEntering(activeRoomId, startRequestVersion)).catch(() => undefined);
        }
        startLocalGame();
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [activeRoomId, countdown, startCountdownActive, startCountdownEndsAt, startCountdownStartsAt, startRequestVersion, startStatus]);

  useEffect(() => {
    if (!activeRoomId || !currentUserId || screen !== 'game' || !startRequestVersion) return;
    const presenceKey = `${activeRoomId}:${currentUserId}:${startRequestVersion}`;
    if (enteredGamePresenceKeyRef.current === presenceKey) return;
    enteredGamePresenceKeyRef.current = presenceKey;
    void measureFirebaseLatency(() => updateRoomPlayer(activeRoomId, currentUserId, { enteredGameAt: Date.now(), enteredStartVersion: startRequestVersion, lastGamePresenceAt: Date.now() })).catch(() => {
      enteredGamePresenceKeyRef.current = '';
    });
  }, [activeRoomId, currentUserId, screen, startRequestVersion]);

  useEffect(() => {
    if (!activeRoomId || !canResolveInitialOnlineTurnOrder || screen !== 'game' || !waitingForPlayersReady || turnOrderIntro || turnOrderIds.length > 0 || !startRequestVersion || !allHumansEnteredGame) return;
    beginTurnOrderIntro();
  }, [activeRoomId, allHumansEnteredGame, canResolveInitialOnlineTurnOrder, screen, startRequestVersion, turnOrderIds.length, turnOrderIntro, waitingForPlayersReady]);

  useEffect(() => {
    if (!activeRoomId || !canResolveInitialOnlineTurnOrder || screen !== 'game' || !waitingForPlayersReady || turnOrderIntro || turnOrderIds.length > 0 || !startRequestVersion || allHumansEnteredGame || !allReady || !pieces.length) return undefined;
    const timer = window.setTimeout(() => {
      if (!allHumansEnteredGame) beginTurnOrderIntro();
    }, TURN_ORDER_PRESENCE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, allHumansEnteredGame, allReady, canResolveInitialOnlineTurnOrder, pieces.length, screen, startRequestVersion, turnOrderIds.length, turnOrderIntro, waitingForPlayersReady]);

  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || isMyTurn || winner) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (sequenceReplayInProgressRef.current || moveInProgressRef.current || now - lastSequenceWatchdogAtRef.current < SEQUENCE_WATCHDOG_MS) return;
      lastSequenceWatchdogAtRef.current = now;
      const localSequence = lastAppliedSequenceRef.current;
      void measureFirebaseLatency(() => getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence))).then((sequences) => {
        const latestSequence = Math.max(0, ...sequences.map((sequence) => Number(sequence.sequence ?? 0)));
        const latestState = [...sequences].reverse().find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
        if (latestSequence > localSequence && latestState) void replayMissingSequencesThenApply(latestState, localSequence, latestSequence);
      }).catch(() => undefined);
    }, SEQUENCE_WATCHDOG_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, isMyTurn, screen, winner]);

  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || pendingLocalRemoteActionCount <= 0) return undefined;
    const timer = window.setInterval(() => {
      void reconcilePendingLocalRemoteActions().catch(() => undefined);
    }, SEQUENCE_WATCHDOG_MS);
    return () => window.clearInterval(timer);
  }, [activeRoomId, pendingLocalRemoteActionCount, screen]);

  useEffect(() => {
    if (!pendingTrapPlacement) return undefined;
    setTrapPlacementClock(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTrapPlacementClock(now);
      if (now >= pendingTrapPlacement.deadline) {
        setPendingTrapPlacement(null);
        addLog('함정 설치 시간이 만료되었습니다.');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [pendingTrapPlacement?.deadline]);


  useEffect(() => {
    if (!pendingItemPickup) return undefined;
    setItemPickupClock(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setItemPickupClock(now);
      if (now >= pendingItemPickup.deadline) keepPendingItemPickup(pendingItemPickup);
    }, 250);
    return () => window.clearInterval(timer);
  }, [pendingItemPickup?.deadline]);


  const getLocalActionKey = (type: GameAction['type'], payload: Record<string, unknown> = {}) => {
    const turnKey = `${lastAppliedSequenceRef.current}:${turnIndex}:${roll ? `${roll.name}:${roll.steps}` : 'ready'}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`;
    if (type === 'roll_yut') return `${type}:${localSeatId}:${turnKey}`;
    if (type === 'move_piece') return `${type}:${localSeatId}:${turnKey}:${payload.pieceId ?? ''}:${payload.extraSteps ?? 0}:${payload.branchChoice ?? ''}`;
    if (type === 'turn_order_roll') return `${type}:${payload.actorId ?? localSeatId}:${turnOrderPhase.index}:${turnOrderPhase.rolls.length}`;
    if (type === 'place_trap') return `${type}:${localSeatId}:${pendingTrapPlacement?.pieceId ?? ''}:${payload.nodeId ?? ''}`;
    return `${type}:${localSeatId}:${turnKey}:${payload.itemType ?? ''}:${payload.pieceId ?? ''}`;
  };

  function getPlayerCardName(seat: Seat) {
    const displayName = seat.name.replace(new RegExp(`^${seat.label}\\s*-\\s*`), '');
    return seat.isAI ? displayName.replace(/\s+AI$/u, '') : displayName;
  }

  function getSeatDisplayName(seat: Seat) {
    return getPlayerCardName(seat);
  }

  function getActorLogName(seat: Seat | undefined) {
    if (!seat) return '';
    return getSeatDisplayName(seat);
  }

  const { getLogCardStyle, renderLogText } = createGameLogPresentation({
    getSeatDisplayName,
    getSeatPieceColor,
    playableSeats,
    playMode,
  });

  function withActorLogPayload(payload: Record<string, unknown> = {}, seat: Seat | undefined = getSeatById(localSeatId)) {
    return { ...payload, actorLabel: seat?.label ?? '', actorName: seat?.name ?? '', actorLogName: getActorLogName(seat) };
  }

  async function waitForRoomCreationCleanup(label: string, cleanup: () => Promise<unknown>) {
    let timeoutId = 0;
    const cleanupResult = await Promise.race([
      cleanup().then(() => 'done' as const).catch((error) => {
        console.warn(`${label}에 실패했습니다. 방 생성은 계속 진행합니다.`, error);
        return 'failed' as const;
      }),
      new Promise<'timeout'>((resolve) => {
        timeoutId = window.setTimeout(() => resolve('timeout'), CREATE_ROOM_CLEANUP_TIMEOUT_MS);
      }),
    ]);
    if (timeoutId) window.clearTimeout(timeoutId);
    if (cleanupResult === 'timeout') console.warn(`${label}이 지연되어 방 생성은 계속 진행합니다.`);
  }

  async function leavePreviousOnlineRoom(nextRoomId = '') {
    const previousRoomId = activeRoomIdRef.current || window.localStorage.getItem(STORAGE_KEYS.activeRoomId) || '';
    const roomUser = userRef.current ?? currentUser;
    if (!previousRoomId || previousRoomId === nextRoomId || !isFirebaseConfigured || !roomUser) return;
    try {
      const previousRoom = await getRoom(previousRoomId);
      if (!previousRoom) return;
      await removeRoomPlayer(previousRoomId, roomUser.uid);
    } catch (error) {
      console.warn('이전 방 정리에 실패했습니다.', error);
    } finally {
      if (activeRoomIdRef.current === previousRoomId) setActiveRoomId('');
      window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
      window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    }
  }


  function showRoomCreationFailure(messageText: string) {
    setMessage(messageText);
    setRoomNoticeDialog({ title: '방 생성에 실패했습니다', message: messageText });
  }

  async function findCreatedRoomWithTimeout(hostId: string) {
    return Promise.race([
      findActiveRoomByHost(hostId),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), CREATE_ROOM_RECOVERY_TIMEOUT_MS)),
    ]);
  }

  async function handleCreateRoom() {
    if (!nickname.trim()) { setMessage('닉네임을 먼저 정해주세요.'); return; }
    if (isCreatingRoom) return;
    setIsCreatingRoom(true);
    setMessage('');
    setLoadingMessage(isFirebaseConfigured && !currentUser ? '입장 준비를 마친 뒤 방을 만드는 중입니다...' : '방을 만드는 중입니다. 잠시만 기다려주세요...');
    let roomHost = userRef.current ?? currentUser;
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('CREATE_ROOM_TIMEOUT')), CREATE_ROOM_TIMEOUT_MS));
      const roomMaxPlayers = normalizeMaxPlayers(maxPlayers, playMode);
      if (roomMaxPlayers !== maxPlayers) setMaxPlayers(roomMaxPlayers);
      if (!isFirebaseConfigured) {
        setLoadingMessage('');
        setMessage('Firebase 연결 정보가 없어 온라인 방을 만들 수 없습니다.');
        return;
      }
      roomHost = roomHost ?? await Promise.race([signInAsGuest(), timeout]);
      if (!roomHost) throw new Error('입장 준비가 끝난 뒤 다시 시도하세요.');
      rememberUser(roomHost);
      const roomHostId = roomHost.uid;
      await waitForRoomCreationCleanup('중복 방 정리', () => leaveDuplicatePlayerRooms(roomHostId));
      await waitForRoomCreationCleanup('이전 방 정리', () => leavePreviousOnlineRoom());
      const roomId = await Promise.race([createRoom({ title, hostId: roomHost.uid, nickname, maxPlayers: roomMaxPlayers, itemMode, stackedRollMode, playMode, pieceCount }), timeout]);
      await openWaitingRoom({ id: roomId, title, itemMode, stackedRollMode, maxPlayers: roomMaxPlayers, playMode, pieceCount }, '', true, roomHost);
    } catch (error) {
      if (isFirebaseConfigured && roomHost && error instanceof Error && error.message === 'CREATE_ROOM_TIMEOUT') {
        setLoadingMessage('응답이 지연되어 생성된 방을 확인하고 있습니다...');
        const recoveredRoom = await findCreatedRoomWithTimeout(roomHost.uid);
        if (recoveredRoom) {
          await openWaitingRoom(recoveredRoom, '방 생성은 완료되어 대기실로 이동했습니다.', true, roomHost);
        } else {
          setLoadingMessage('');
          showRoomCreationFailure('방 만들기 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
        }
      } else {
        setLoadingMessage('');
        showRoomCreationFailure(error instanceof Error ? error.message : '방 생성에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
      }
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function openWaitingRoom(room: Pick<RoomSummary, 'title' | 'itemMode' | 'stackedRollMode' | 'maxPlayers' | 'playMode' | 'pieceCount'> & { id?: string }, nextMessage = '', asHost = false, hostUserOverride: User | null = null) {
    leavingRoomRef.current = false;
    setLoadingMessage('방으로 이동하는 중입니다...');
    const nextMaxPlayers = room.maxPlayers as 2 | 3 | 4;
    try {
      const roomUser = asHost && hostUserOverride ? hostUserOverride : userRef.current ?? currentUser;
      hostingRoomUserIdRef.current = asHost && roomUser ? roomUser.uid : '';
      if (asHost && roomUser) rememberUser(roomUser);
      const joiningUser = !asHost && room.id && isFirebaseConfigured ? roomUser ?? await Promise.race([
        signInAsGuest(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('JOIN_ROOM_TIMEOUT')), CREATE_ROOM_TIMEOUT_MS)),
      ]) : roomUser;
      if (!asHost && room.id && isFirebaseConfigured && !joiningUser) throw new Error('입장 준비가 끝난 뒤 다시 시도하세요.');
      if (joiningUser) rememberUser(joiningUser);
      if (!asHost && joiningUser && room.id) await leaveDuplicatePlayerRooms(joiningUser.uid, room.id);
      await leavePreviousOnlineRoom(room.id ?? '');
      const joinResult = !asHost && room.id && joiningUser ? await joinRoom(room.id, { userId: joiningUser.uid, nickname, playMode: room.playMode }) : null;
      setActiveRoomId(room.id ?? '');
      setIsRoomHost(asHost);
      setActiveRoomTitle(room.title);
      setActiveRoomHostId(asHost && roomUser ? roomUser.uid : ('hostId' in room ? String((room as RoomSummary).hostId ?? '') : ''));
      setPlayMode(room.playMode);
      setMaxPlayers(nextMaxPlayers);
      setItemMode(room.itemMode);
      setStackedRollMode(Boolean(room.stackedRollMode));
      setPieceCount(room.pieceCount ?? 4);
      const nextSeats = createSeats(nickname, room.playMode, nextMaxPlayers);
      if (joinResult?.role === 'player' && joiningUser) {
        setSeats(seatsWithJoinedPlayer([], joiningUser.uid, nickname, room.playMode, nextMaxPlayers, joinResult.seatIndex));
      } else if (asHost && roomUser) {
        setSeats(nextSeats.map((seat) => seat.isHost ? { ...seat, id: roomUser.uid } : seat));
      } else {
        setSeats(nextSeats);
      }
      setScreen(room.id && !asHost && 'status' in room && isRoomInGame(room as RoomSummary) ? 'game' : 'waitingRoom');
      setLoadingMessage('');
      setMessage(nextMessage);
    } catch (error) {
      hostingRoomUserIdRef.current = '';
      setActiveRoomId('');
      setIsRoomHost(false);
      setActiveRoomTitle('');
      setActiveRoomHostId('');
      setScreen('lobby');
      setLoadingMessage('');
      setMessage(error instanceof Error ? error.message : '방 참가에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
    }
  }

  function handleStartGame() {
    const blockMessage = getStartGameBlockMessage({ activeRoomId, allReady, canManageRoom, playMode, teamBalanced });
    if (roomInGame) { setMessage('이미 진행 중인 게임이 있어 다시 시작할 수 없습니다.'); return; }
    if (blockMessage) { setMessage(blockMessage); return; }
    if (!isRoomManager) setIsRoomHost(true);
    const requestedAt = Date.now();
    const startCountdownWindow = createStartCountdownWindow(requestedAt, startRequestVersion);
    const localVersion = startCountdownWindow.localVersion;
    setStartRequestVersion(localVersion);
    setStartCountdownStartsAt(startCountdownWindow.startsAt);
    setStartCountdownEndsAt(startCountdownWindow.endsAt);
    setStartStatus('requested');
    setCountdown(-1); setScreen('waitingRoom'); setMessage('');
    void measureFirebaseLatency(() => requestRoomGameStart(activeRoomId, requestedAt)).then((startState) => {
      setStartRequestVersion(startState.startRequestVersion);
      setStartCountdownStartsAt(startState.startCountdownStartsAt);
      setStartCountdownEndsAt(startState.startCountdownEndsAt);
      setStartStatus('requested');
    }).catch((error) => setMessage(error instanceof Error ? error.message : '게임 시작 요청에 실패했습니다.'));
  }

  function cancelStartCountdown() {
    if (startCancelDisabled) return;
    setCountdown(-1);
    setStartStatus('cancelled');
    setMessage('시작이 취소되었습니다.');
    if (activeRoomId) void measureFirebaseLatency(() => cancelRoomGameStart(activeRoomId, startRequestVersion, Date.now()));
    else setStartCountdownEndsAt(0);
  }

  function decideTurnOrder(rolls = resolveTurnOrderRolls(playableSeats, { getSeatDisplayName, onTie: addLog })) {
    const { rankedRolls, turnOrder } = getTurnOrderFromRolls(rolls, playMode);
    addLogs(getTurnOrderLogTexts(rankedRolls, turnOrder, getSeatDisplayName));
    setTurnOrderIds(turnOrder.map((seat) => seat.id));
    return turnOrder;
  }

  function resetGameBoard(nextPieces: BoardPiece[]) {
    setPieces(nextPieces);
    setBoardItems(itemMode ? spawnInitialBoardItems(4, 8) : []);
    setOwnedItems({}); setTrapNodes([]); setShieldedPieceIds([]); setLastMovedPieceIds([]); setLastMovedSeatId(''); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); clearRoll(); setRollStack([]); setSelectedRollStackIndex(null); setRollStackClosed(false); setForcedRoll(null); setGoldenYutPickerOpen(false); setItemPromptTiming(null); setBranchChoice('outer'); setCaptureEffect(null); setTrapEffect(null); setPendingTrapPlacement(null);
  }

  function beginTurnOrderIntro() {
    const shuffledSeats = getSeededTurnOrderSeats(playableSeats, `${activeRoomId}:${startRequestVersion}`);
    const orderedSeats = playMode === 'team'
      ? buildAlternatingTeamTurnOrder(shuffledSeats.map((seat) => ({ seat, result: { name: '도', steps: 1, bonus: false }, rollOffRound: 1 })))
      : shuffledSeats;
    const nextTurnOrderIds = orderedSeats.map((seat) => seat.id);
    const { slotUntil, intro: nextTurnOrderIntro } = createTurnOrderIntro(orderedSeats, { getSeatPieceColor, playMode, finalHoldMs: TURN_ORDER_FINAL_HOLD_MS });
    const nextGameStartedAt = nextTurnOrderIntro.readyAt;
    const introLog = makeLog(formatTurnOrderSummary(orderedSeats, getSeatDisplayName));
    const nextLogs = [introLog, ...logs];
    if (activeRoomId) {
      const clientMutationId = `turn_order_intro:${activeRoomId}:${startRequestVersion}`;
      void measureFirebaseLatency(() => resolveTurnOrderIntro(activeRoomId, {
        turnOrderIds: nextTurnOrderIds,
        initialTurnOrderIds: nextTurnOrderIds,
        logs: nextLogs,
        gameStartedAt: nextGameStartedAt,
        turnOrderIntro: nextTurnOrderIntro,
        turnOrderPhase: { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 },
        waitingForPlayersReady: false,
      }, {
        actorId: localSeatId,
        clientMutationId,
        startRequestVersion,
        payload: { startRequestVersion, turnOrderIds: nextTurnOrderIds, slotUntil, readyAt: nextTurnOrderIntro.readyAt },
      })).then((result) => {
        if (typeof result.lastSequence === 'number') lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.lastSequence);
        if (result.turnVersion) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, result.turnVersion);
        if (result.status !== 'committed' && result.status !== 'duplicate') setMessage('순서 정하기 결과 저장이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
      }).catch((error) => setMessage(error instanceof Error ? error.message : '순서 정하기 결과 저장에 실패했습니다.'));
      return;
    }
    setLogs(nextLogs);
    setTurnOrderIds(nextTurnOrderIds);
    setInitialTurnOrderIds(nextTurnOrderIds);
    setTurnOrderIntro(nextTurnOrderIntro);
    setWaitingForPlayersReady(false);
    setAuthoritativeWinner('');
    setGameStartedAt(nextGameStartedAt);
  }

  function startLocalGame() {
    if (!activeRoomId) {
      setMessage('온라인 방 정보가 없어 게임을 시작할 수 없습니다.');
      setScreen('lobby');
      return;
    }
    if (activeRoomId && startRequestVersion && startedGameRequestVersionsRef.current.has(startRequestVersion)) return;
    logIdRef.current = 0;
    if (activeRoomId && startRequestVersion) startedGameRequestVersionsRef.current.add(startRequestVersion);
    const nextPieces = makePieces(playableSeats, pieceCount, playMode);
    const nextGameSeats = gameSeatSnapshotsFromSeats(playableSeats);
    const nextBoardItems = itemMode ? spawnInitialBoardItems(4, 8) : [];
    const initialTurnOrderPhase = { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 };
    const shuffledSeats = getSeededTurnOrderSeats(playableSeats, `${activeRoomId}:${startRequestVersion}`);
    const orderedSeats = playMode === 'team'
      ? buildAlternatingTeamTurnOrder(shuffledSeats.map((seat) => ({ seat, result: { name: '도', steps: 1, bonus: false }, rollOffRound: 1 })))
      : shuffledSeats;
    const initialTurnOrderIds = orderedSeats.map((seat) => seat.id);
    const { intro: initialTurnOrderIntro } = createTurnOrderIntro(orderedSeats, { getSeatPieceColor, playMode, finalHoldMs: TURN_ORDER_FINAL_HOLD_MS });
    const initialGameStartedAt = initialTurnOrderIntro.readyAt;
    const initialTurnDeadlineAt = initialGameStartedAt + TURN_ACTION_TIMEOUT_MS;
    const prepLog = makeLog(formatTurnOrderSummary(orderedSeats, getSeatDisplayName));
    resetGameBoard(nextPieces);
    setBoardItems(nextBoardItems);
    setLogs([prepLog]);
    setTurnOrderIds(initialTurnOrderIds);
    setInitialTurnOrderIds(initialTurnOrderIds);
    setTurnOrderIntro(initialTurnOrderIntro);
    setTurnOrderPhase(initialTurnOrderPhase);
    setAuthoritativeWinner('');
    setWaitingForPlayersReady(false);
    setTurnDeadlineAt(initialTurnDeadlineAt);
    setTurnDeadlineKind('roll');
    setGameStartedAt(initialGameStartedAt);
    setScreen('game');
    const initialSyncedState = {
      pieces: nextPieces,
      turnIndex: 0,
      turnOrderIds: initialTurnOrderIds,
      initialTurnOrderIds: initialTurnOrderIds,
      completedSeatIds: [],
      rankingSeatIds: [],
      gameEndMode: '' as const,
      lastFinishedSeatId: '',
      continuationRound: 0,
      roll: null,
      rollStack: [],
      selectedRollStackIndex: null,
      rollStackClosed: false,
      boardItems: nextBoardItems,
      ownedItems: {},
      trapNodes: [],
      shieldedPieceIds: [],
      logs: [prepLog],
      winner: '',
      captureEffect: null,
      trapEffect: null,
      fallEffect: null,
      gameStartedAt: initialGameStartedAt,
      turnOrderIntro: initialTurnOrderIntro,
      pendingTrapPlacement: null,
      rollLockUntil: 0,
      lastMovedPieceIds: [],
      lastMovedSeatId: '',
      itemPromptTiming: null,
      branchChoice: 'outer',
      rollResultReadyAt: 0,
      turnOrderPhase: initialTurnOrderPhase,
      waitingForPlayersReady: false,
      turnDeadlineAt: initialTurnDeadlineAt,
      turnDeadlineKind: 'roll' as const,
      gameSeats: nextGameSeats,
      startRequestVersion,
    };
    const initialStateFingerprint = makeGameStateFingerprint({ pieces: nextPieces, turnIndex: 0, turnOrderIds: initialTurnOrderIds, initialTurnOrderIds, completedSeatIds: [], rankingSeatIds: [], gameEndMode: '', lastFinishedSeatId: '', continuationRound: 0, roll: null, rollStack: [], selectedRollStackIndex: null, rollStackClosed: false, boardItems: nextBoardItems, ownedItems: {}, trapNodes: [], shieldedPieceIds: [], winner: '', gameStartedAt: initialGameStartedAt, turnOrderIntro: initialTurnOrderIntro, pendingTrapPlacement: null, rollLockUntil: 0, lastMovedPieceIds: [], lastMovedSeatId: '', effectiveRollResultReadyAt: 0, turnOrderPhase: initialTurnOrderPhase, waitingForPlayersReady: false, turnDeadlineAt: initialTurnDeadlineAt, turnDeadlineKind: 'roll', startRequestVersion, logs: [prepLog], gameSeats: nextGameSeats });
    savingStateFingerprintRef.current = initialStateFingerprint;
    const initialGameStateSaveStartedAt = Date.now();
    setInitialGameStateSaveDiagnostic({
      status: 'pending',
      turnVersion: 0,
      lastSequence: 0,
      startedAt: initialGameStateSaveStartedAt,
      completedAt: 0,
      source: 'initializeGameState',
      message: '',
      fingerprint: initialStateFingerprint.slice(0, 24),
    });
    void measureFirebaseLatency(() => initializeGameState(activeRoomId, initialSyncedState, {
      actorId: localSeatId,
      startRequestVersion,
      clientMutationId: `game_initialized:${activeRoomId}:${startRequestVersion}`,
      payload: { startRequestVersion },
    })).then(async (result) => {
      const lastSequence = Number(result.lastSequence ?? 0);
      const turnVersion = Number(result.turnVersion ?? 0);
      const completedAt = Date.now();
      if (lastSequence) lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, lastSequence);
      if (turnVersion) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, turnVersion);
      setInitialGameStateSaveDiagnostic({
        status: result.status,
        turnVersion,
        lastSequence,
        startedAt: initialGameStateSaveStartedAt,
        completedAt,
        source: 'initializeGameState',
        message: '',
        fingerprint: initialStateFingerprint.slice(0, 24),
      });
      if (result.status === 'committed' || result.status === 'duplicate') {
        setAuthoritativeGameStateReady(true);
        lastSavedStateFingerprintRef.current = initialStateFingerprint;
        savingStateFingerprintRef.current = '';
        setCoordinatorStateSaveKey('');
        return;
      }
      if (lastSequence > 0) {
        const sequences = await measureFirebaseLatency(() => getGameSequencesSince(activeRoomId, 0));
        const latestState = [...sequences]
          .filter((sequence) => Number(sequence.sequence ?? 0) <= lastSequence)
          .reverse()
          .find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
        if (latestState) {
          await replayMissingSequencesThenApply(latestState, 0, lastSequence);
          setAuthoritativeGameStateReady(true);
          setInitialGameStateSaveDiagnostic((current) => current ? { ...current, source: `${current.source}:sequence-replay`, message: '초기 저장 불일치 후 최신 sequence를 적용했습니다.' } : current);
          return;
        }
      }
      setMessage(result.status === 'sequence_mismatch'
        ? '게임 시작 정보가 갱신되어 최신 게임 상태를 기다리고 있습니다.'
        : '게임 상태 저장이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    }).catch((error) => {
      setInitialGameStateSaveDiagnostic({
        status: 'error',
        turnVersion: 0,
        lastSequence: 0,
        startedAt: initialGameStateSaveStartedAt,
        completedAt: Date.now(),
        source: 'initializeGameState',
        message: error instanceof Error ? error.message : '게임 상태 저장 중 알 수 없는 오류가 발생했습니다.',
        fingerprint: initialStateFingerprint.slice(0, 24),
      });
      setMessage(error instanceof Error ? error.message : '게임 상태 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }).finally(() => {
      if (savingStateFingerprintRef.current === initialStateFingerprint) savingStateFingerprintRef.current = '';
    });
  }

  function completeTurnOrderRolls(rolls: TurnOrderRoll[]) {
    const rolledSeatIds = new Set(rolls.map((rollEntry) => rollEntry.seat.id));
    const fallbackRolls = playableSeats
      .filter((seat) => !rolledSeatIds.has(seat.id))
      .map((seat) => {
        const rolled = rollYutResult(undefined, false);
        return { seat, result: rolled.result, rollOffRound: 1 };
      });
    return [...rolls, ...fallbackRolls];
  }

  function makeTurnOrderCeremonyPatch(sourceRolls: TurnOrderRoll[], currentLogs: GameLog[]) {
    const rolledSeatIds = new Set(sourceRolls.map((rollEntry) => rollEntry.seat.id));
    const timeoutLogTexts = playableSeats
      .filter((seat) => !rolledSeatIds.has(seat.id))
      .map((seat) => `${getSeatDisplayName(seat)}님이 시간 초과로 자동 순서 정하기 굴림 처리되었습니다.`);
    const completedRolls = completeTurnOrderRolls(sourceRolls);
    const { rankedRolls, turnOrder: orderedSeats } = getTurnOrderFromRolls(completedRolls, playMode);
    const nextPieces = makePieces(orderedSeats, pieceCount, playMode);
    const nextTurnOrderPhase = { active: false, index: 0, rolls: completedRolls, deadline: 0, readyAt: 0 };
    const nextTurnOrderIds = orderedSeats.map((seat) => seat.id);
    const nextBoardItems = itemMode ? spawnInitialBoardItems(4, 8) : [];
    const { intro: nextTurnOrderIntro } = createTurnOrderIntro(orderedSeats, { getSeatPieceColor, playMode, finalHoldMs: TURN_ORDER_FINAL_HOLD_MS });
    const nextGameStartedAt = nextTurnOrderIntro.readyAt;
    const finalOrderLog = formatTurnOrderSummary(orderedSeats, getSeatDisplayName);
    const ceremonyLogs = [...timeoutLogTexts, ...getTurnOrderLogTexts(rankedRolls, orderedSeats, getSeatDisplayName)].reverse().map((text) => makeLog(text));

    return {
      local: { completedRolls, orderedSeats, nextPieces, nextBoardItems, nextTurnOrderIds, nextTurnOrderPhase, nextTurnOrderIntro, nextGameStartedAt, finalOrderLog, nextLogs: [...ceremonyLogs, ...currentLogs] },
      patch: {
        pieces: nextPieces,
        boardItems: nextBoardItems,
        ownedItems: {},
        trapNodes: [],
        shieldedPieceIds: [],
        turnIndex: 0,
        turnOrderIds: nextTurnOrderIds,
        initialTurnOrderIds: nextTurnOrderIds,
        completedSeatIds: [],
        rankingSeatIds: [],
        gameEndMode: '',
        lastFinishedSeatId: '',
        continuationRound: 0,
        roll: null,
        logs: [...ceremonyLogs, ...currentLogs],
        winner: '',
        captureEffect: null,
        trapEffect: null,
        fallEffect: null,
        gameStartedAt: nextGameStartedAt,
        turnOrderIntro: nextTurnOrderIntro,
        pendingTrapPlacement: null,
        rollLockUntil: 0,
        lastMovedPieceIds: [],
        lastMovedSeatId: '',
        itemPromptTiming: null,
        branchChoice: 'outer',
        rollResultReadyAt: 0,
        turnOrderPhase: nextTurnOrderPhase,
      },
    };
  }

  function finishTurnOrderCeremony(rolls: TurnOrderRoll[]) {
    if (!canCoordinateOnlineGame) return;

    const { local } = makeTurnOrderCeremonyPatch(rolls, logs);
    if (activeRoomId) {
      pendingSequenceMetaRef.current = {
        type: 'turn_order_resolved',
        actorId: localSeatId,
        clientMutationId: `turn_order_resolved:${activeRoomId}:${startRequestVersion}:${local.nextTurnOrderIntro.readyAt}`,
        payload: {
          startRequestVersion,
          turnOrderIds: local.nextTurnOrderIds,
          completedRollCount: local.completedRolls.length,
          slotUntil: local.nextTurnOrderIntro.slotUntil,
          readyAt: local.nextTurnOrderIntro.readyAt,
        },
      };
    }
    setPieces(local.nextPieces);
    setBoardItems(local.nextBoardItems);
    setOwnedItems({}); setTrapNodes([]); setShieldedPieceIds([]); setLastMovedPieceIds([]); setLastMovedSeatId(''); setRevealedItems([]); setSelectedPieceId(local.nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); clearRoll(); setRollStack([]); setSelectedRollStackIndex(null); setRollStackClosed(false); setForcedRoll(null); setGoldenYutPickerOpen(false); setItemPromptTiming(null); setBranchChoice('outer'); setCaptureEffect(null); setTrapEffect(null); setPendingTrapPlacement(null);
    setTurnOrderIds(local.nextTurnOrderIds);
    setInitialTurnOrderIds(local.nextTurnOrderIds);
    setCompletedSeatIds([]);
    setRankingSeatIds([]);
    setGameEndMode('');
    setLastFinishedSeatId('');
    setAuthoritativeWinner('');
    setContinuationRound(0);
    setTurnOrderPhase(local.nextTurnOrderPhase);
    setTurnOrderIntro(local.nextTurnOrderIntro);
    setGameStartedAt(local.nextGameStartedAt);
    setLogs(local.nextLogs);
  }

  function rollForTurnOrder(fromRemote = false, requestedSeatId = localSeatId) {
    if (!turnOrderPhase.active || Date.now() < turnOrderPhase.readyAt) return;
    const seat = playableSeats.find((candidate) => candidate.id === requestedSeatId);
    if (!seat) return;
    const rolled = rollYutResult(undefined, false);
    const rollEntry = { seat, result: rolled.result, rollOffRound: 1 };
    const nextAnimation = { id: Date.now(), result: rolled.result, sticks: rolled.sticks, turnOrder: true };
    const logText = `${getSeatDisplayName(seat)}님이 순서 정하기에서 ${rolled.result.name}(${getTurnOrderScore(rolled.result)}점)를 던졌습니다.`;

    const canSubmitOnlineTurnOrderRoll = !activeRoomId || fromRemote || requestedSeatId === localSeatId || Boolean(seat.isAI && canCoordinateOnlineGame);
    if (!canSubmitOnlineTurnOrderRoll) return;
    const clientMutationId = getLocalActionKey('turn_order_roll', { actorId: requestedSeatId });
    if (activeRoomId && !fromRemote) {
      pendingSequenceMetaRef.current = { type: 'turn_order_roll', actorId: requestedSeatId, clientMutationId, payload: { rollIndex: turnOrderPhase.rolls.length }, action: { type: 'turn_order_roll', actorId: requestedSeatId, payload: withActorLogPayload({ clientActionId: clientMutationId }, seat) } };
    }

    let accepted = false;
    setTurnOrderPhase((current) => {
      if (!current.active || current.rolls.some((entry) => entry.seat.id === seat.id)) return current;
      accepted = true;
      return { ...current, rolls: [...current.rolls, rollEntry] };
    });
    if (!accepted) return;
    setRollAnimation(nextAnimation);
    playSfx('roll');
    window.setTimeout(() => setRollAnimation(null), TURN_ORDER_ROLL_ANIMATION_MS);
    addLog(logText);
  }

  function playSfx(effect: SoundEffect) { playSoundEffect(effect, soundEnabled); }
  function makeLog(text: string): GameLog {
    logIdRef.current += 1;
    return { id: logIdRef.current, text };
  }
  function shouldSuppressDuplicateLog(text: string, currentLogs: GameLog[]) {
    const recentSameText = currentLogs.slice(0, 6).find((log) => log.text === text);
    if (!recentSameText) return false;
    return /아이템|함정|방패|순서|관전자로 입장|시간이 만료/.test(text);
  }
  function addLog(text: string) {
    setLogs((current) => shouldSuppressDuplicateLog(text, current) ? current : [makeLog(text), ...current]);
  }
  function ensureRollLogExists(seat: Seat, result: YutResult) {
    const rollLogText = `${getSeatDisplayName(seat)}님이 ${result.name}(${result.steps}칸)를 던졌습니다.`;
    setLogs((current) => {
      const currentTurnLogs = [];
      for (const log of current.slice(0, 8)) {
        if (log.text.includes('한 번 더 던질 수 있습니다.')) break;
        currentTurnLogs.push(log);
      }
      return currentTurnLogs.some((log) => log.text === rollLogText) ? current : [makeLog(rollLogText), ...current];
    });
  }
  function addLogs(texts: string[]) {
    setLogs((current) => {
      const uniqueTexts = texts.filter((text, index) => texts.indexOf(text) === index && !shouldSuppressDuplicateLog(text, current));
      return [...uniqueTexts].reverse().map((text) => makeLog(text)).concat(current);
    });
  }
  async function copyDiagnosticState() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnosticText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = diagnosticText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setDiagnosticCopied(true);
      window.setTimeout(() => setDiagnosticCopied(false), 1800);
    } catch {
      setDiagnosticCopied(false);
      showToast('복사 실패', '상태값을 복사하지 못했습니다. 내용을 직접 선택해 복사해주세요.', '⚠️');
    }
  }
  function showToast(title: string, description?: string, icon?: string) {
    const nextToast = { id: Date.now(), title, description, icon };
    setToast(nextToast);
    playSfx('toast');
    return new Promise<void>((resolve) => {
      window.setTimeout(() => {
        setToast((current) => current?.id === nextToast.id ? null : current);
        resolve();
      }, TOAST_MESSAGE_MS);
    });
  }
  function showItemPickupEffect(event: Record<string, unknown>, effectKey: string) {
    if (lastSyncedItemEventKeyRef.current === effectKey) return;
    const itemType = event.itemType as ItemType | undefined;
    const nodeId = String(event.nodeId ?? '');
    const ownerId = String(event.ownerId ?? '');
    const itemId = String(event.itemId ?? '');
    if (!itemType || !ITEM_DEFINITIONS[itemType]) return;
    lastSyncedItemEventKeyRef.current = effectKey;
    const ownerSeat = getSeatById(ownerId);
    const ownerName = ownerSeat ? getSeatDisplayName(ownerSeat) : '누군가';
    const item = ITEM_DEFINITIONS[itemType];
    const existingItemType = event.existingItemType as ItemType | null | undefined;
    if (ownerId === localSeatId && existingItemType && ITEM_DEFINITIONS[existingItemType] && !ownerSeat?.isAI) {
      setPendingItemPickup({ seatId: ownerId, item: itemType, itemId, existingItem: existingItemType, deadline: Date.now() + ITEM_REPLACE_TIMEOUT_MS });
    }
    setRevealedItems((items) => Array.from(new Set([...items, itemType])));
    void showToast(`${ownerName}님 아이템 획득`, item.name, item.icon);
    playSfx('itemPickup');
    if (nodeId) {
      setHighlightedNodeId(nodeId);
      window.setTimeout(() => setHighlightedNodeId((current) => current === nodeId ? '' : current), 1400);
    }
  }
  function resolvePendingItemPickup() {
    setPendingItemPickup(null);
    pendingItemPickupResolverRef.current?.();
    pendingItemPickupResolverRef.current = null;
  }
  function findItemWithSameTiming(items: ItemType[], item: ItemType) {
    const timing = ITEM_DEFINITIONS[item].timing;
    return items.find((type) => ITEM_DEFINITIONS[type].timing === timing);
  }
  function keepPendingItemPickup(pickup = pendingItemPickup) {
    if (!pickup) return;
    setBoardItems((items) => items.filter((item) => item.id !== pickup.itemId));
    addLog(`새 아이템 '${ITEM_DEFINITIONS[pickup.item].name}'을 유지하지 않았습니다.`);
    resolvePendingItemPickup();
  }
  function replacePendingItemPickup(pickup = pendingItemPickup) {
    if (!pickup) return;
    setOwnedItems((items) => ({
      ...items,
      [pickup.seatId]: (items[pickup.seatId] ?? []).map((type) => type === pickup.existingItem ? pickup.item : type),
    }));
    setBoardItems((items) => items.filter((item) => item.id !== pickup.itemId));
    addLog(`아이템 '${ITEM_DEFINITIONS[pickup.existingItem].name}'을 '${ITEM_DEFINITIONS[pickup.item].name}'으로 교체했습니다.`);
    resolvePendingItemPickup();
  }
  function getUsableHostItems(timing: ItemTiming) {
    if (movingPieceId || winner) return [];
    if (timing === 'after_roll' && (!isMyTurn || !roll)) return [];
    if (timing === 'after_move' && (!isMyTurn || lastMovedSeatId !== localSeatId)) return [];
    return (ownedItems[localSeatId] ?? []).filter((type) => {
      if (ITEM_DEFINITIONS[type].timing !== timing) return false;
      if ((type === 'move_plus_one' || type === 'move_minus_one') && !getPostMoveAdjustmentPiece(getSeatById(localSeatId))) return false;
      if (type === 'shield') return lastMovedPieceIds.some((id) => pieces.some((piece) => piece.id === id && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished));
      if (type === 'trap') return lastMovedSeatId === localSeatId && lastMovedPieceIds.some((id) => pieces.some((piece) => piece.id === id && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished));
      return true;
    });
  }
  function showItemPrompt(timing: ItemTiming) {
    if (pendingTrapPlacement) return;
    if (getUsableHostItems(timing).length) setItemPromptTiming(timing);
  }
  function makeUniqueAIName(currentSeats: Seat[]) {
    const usedNames = new Set(currentSeats.filter((seat) => !seat.isEmpty).map((seat) => seat.name));
    const candidates = AI_NAME_BASES.flatMap((baseName) => AI_NAME_PREFIXES.map((prefix) => `${prefix} ${baseName}`)).filter((name) => !usedNames.has(name));
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    let suffix = 1;
    while (usedNames.has(`AI 친구 ${suffix}`)) suffix += 1;
    return `AI 친구 ${suffix}`;
  }

  function getSeatIndex(seat: Seat) {
    return Number(seat.label.replace('P', '')) - 1;
  }

  function getAiRoomPlayerUpdate(seat: Seat, aiName: string): Partial<Omit<RoomPlayer, 'id'>> {
    const seatIndex = getSeatIndex(seat);
    return { nickname: aiName, ready: true, isAI: true, seatIndex, color: ['red', 'blue', 'green', 'yellow'][seatIndex] ?? 'black', team: seat.team };
  }

  function markPlayerAsAI(playerId: string) {
    setSeats((currentSeats) => {
      const aiName = makeUniqueAIName(currentSeats);
      const targetSeat = currentSeats.find((seat) => seat.id === playerId);
      if (activeRoomId && targetSeat) {
        pendingAiSeatIdsRef.current.add(playerId);
        void updateRoomPlayer(activeRoomId, playerId, getAiRoomPlayerUpdate(targetSeat, aiName))
          .catch((error) => {
            pendingAiSeatIdsRef.current.delete(playerId);
            console.warn('AI 추가에 실패했습니다.', error);
            setMessage('AI 추가에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
            setSeats((latestSeats) => latestSeats.map((seat) => seat.id === playerId && seat.isAI ? { ...seat, name: '빈 자리', ready: false, isAI: false, isEmpty: true } : seat));
          });
      }
      return currentSeats.map((seat) => seat.id === playerId ? { ...seat, name: aiName, ready: true, isAI: true, isEmpty: false } : seat);
    });
  }
  function cancelAISeat(playerId: string) {
    pendingAiSeatIdsRef.current.delete(playerId);
    if (activeRoomId) { void removeRoomPlayer(activeRoomId, playerId); }
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId && seat.isAI ? { ...seat, name: '빈 자리', ready: false, isAI: false, isEmpty: true } : seat));
  }
  async function kickWaitingPlayer(seat: Seat) {
    if (!activeRoomId || !canManageRoom || seat.isEmpty || seat.isHost || seat.isAI) return;
    const previousSeat = seat;
    setSeats((currentSeats) => currentSeats.map((currentSeat) => currentSeat.id === previousSeat.id ? { ...currentSeat, id: `slot-${Number(currentSeat.label.replace('P', ''))}`, name: '빈 자리', ready: false, isEmpty: true } : currentSeat));
    try {
      await removeRoomPlayer(activeRoomId, previousSeat.id);
      setMessage(`${previousSeat.name}님을 방에서 내보냈습니다.`);
    } catch (error) {
      setSeats((currentSeats) => currentSeats.map((currentSeat) => currentSeat.label === previousSeat.label ? previousSeat : currentSeat));
      setMessage(error instanceof Error ? error.message : '플레이어 강퇴에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
    }
  }
  function changeTeam(playerId: string, team: Team) {
    if (activeRoomId) { void updateRoomPlayer(activeRoomId, playerId, { team }); }
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, team } : seat));
  }
  function rollYutFor(seat: Seat, forcedResult: YutResult | null = forcedRoll, sourceAction: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null = null, options: { recordSequence?: boolean; timingZone?: RollTimingZone } = {}) {
    if (rollInProgressRef.current || currentRollRef.current) return null;
    rollInProgressRef.current = true;
    rollInProgressStartedAtRef.current = Date.now();
    setRollInProgress(true);
    const timingZone = options.timingZone;
    const rolled = forcedResult ? { result: forcedResult, sticks: makeDisplaySticks(forcedResult) } : timingZone ? rollYutResultWithTiming(timingZone) : rollYutResult();
    const nextRoll = rolled.result;
    const rollResultReadyAtMs = Date.now() + ROLL_ANIMATION_MS;
    const animationKey = `${turnIndex}:${nextRoll.name}:${nextRoll.steps}:${rollResultReadyAtMs}`;
    setForcedRoll(null);
    setRollResultReadyAt(rollResultReadyAtMs);
    setTurnDeadlineAt(rollResultReadyAtMs + TURN_ACTION_TIMEOUT_MS);
    setTurnDeadlineKind('move');
    setLastRollTimingZone(timingZone ?? null);
    currentRollRef.current = nextRoll;
    setRoll(nextRoll);
    playRollAnimationOnce(nextRoll, rolled.sticks, animationKey, false, 0, timingZone);
    if (options.recordSequence !== false) {
      pendingSequenceMetaRef.current = { type: 'roll_yut', actorId: seat.id, clientMutationId: sourceAction && typeof sourceAction.payload?.clientActionId === 'string' ? sourceAction.payload.clientActionId : `roll_yut:${seat.id}:${turnIndex}:${nextRoll.name}:${Date.now()}`, payload: { turnIndex, activeSeatId: seat.id, rollName: nextRoll.name, rollTimingZone: timingZone }, action: sourceAction ?? null };
    }
    playSfx('roll');
    if (nextRoll.bonus) window.setTimeout(() => playSfx('bonus'), 420);
    window.setTimeout(() => {
      rollInProgressRef.current = false;
      rollInProgressStartedAtRef.current = 0;
      setRollInProgress(false);
    }, ROLL_ANIMATION_MS);
    addLog(`${getSeatDisplayName(seat)}님이 ${nextRoll.name}(${nextRoll.steps}칸)를 던졌습니다.`);
    return nextRoll;
  }
  function rollYutForStack(seat: Seat, nextRoll: YutResult, sourceAction: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null = null, options: { recordSequence?: boolean; timingZone?: RollTimingZone } = {}) {
    if (rollInProgressRef.current || rollStackClosed || roll) return null;
    rollInProgressRef.current = true;
    rollInProgressStartedAtRef.current = Date.now();
    setRollInProgress(true);
    const timingZone = options.timingZone;
    const rollResultReadyAtMs = Date.now() + ROLL_ANIMATION_MS;
    setForcedRoll(null);
    setRollResultReadyAt(rollResultReadyAtMs);
    setTurnDeadlineAt(rollResultReadyAtMs + TURN_ACTION_TIMEOUT_MS);
    setTurnDeadlineKind('move');
    setLastRollTimingZone(timingZone ?? null);
    playRollAnimationOnce(nextRoll, makeDisplaySticks(nextRoll), `stack:${turnIndex}:${rollStack.length}:${nextRoll.name}:${rollResultReadyAtMs}`, false, 0, timingZone);
    setRollStack((current) => [...current, nextRoll]);
    setSelectedRollStackIndex(null);
    setRollStackClosed(!nextRoll.bonus);
    if (options.recordSequence !== false) {
      pendingSequenceMetaRef.current = { type: 'roll_yut', actorId: seat.id, clientMutationId: sourceAction && typeof sourceAction.payload?.clientActionId === 'string' ? sourceAction.payload.clientActionId : `roll_yut_stack:${seat.id}:${turnIndex}:${nextRoll.name}:${Date.now()}`, payload: { turnIndex, activeSeatId: seat.id, rollName: nextRoll.name, rollTimingZone: timingZone, rollStackMode: true }, action: sourceAction ?? null };
    }
    playSfx('roll');
    if (nextRoll.bonus) window.setTimeout(() => playSfx('bonus'), 420);
    window.setTimeout(() => {
      rollInProgressRef.current = false;
      rollInProgressStartedAtRef.current = 0;
      setRollInProgress(false);
    }, ROLL_ANIMATION_MS);
    return nextRoll;
  }

  function applyLocalFall(seat: Seat, timingZone: RollTimingZone, displayRoll: YutResult, sourceAction: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null = null, options: { recordSequence?: boolean } = {}) {
    const fallStartedAt = Date.now();
    const fallCount = Math.floor(Math.random() * 4) + 1;
    rollInProgressRef.current = true;
    rollInProgressStartedAtRef.current = fallStartedAt;
    setRollInProgress(true);
    setShieldedPieceIds([]);
    setRoll(null);
    currentRollRef.current = null;
    setRollResultReadyAt(0);
    setTurnDeadlineAt(fallStartedAt + ROLL_ANIMATION_MS + TURN_ACTION_TIMEOUT_MS);
    setTurnDeadlineKind('roll');
    setBranchChoice('outer');
    setLastMovedPieceIds([]);
    setLastMovedSeatId(seat.id);
    setFallEffect({ id: fallStartedAt, seatId: seat.id, timingZone });
    setLastRollTimingZone(timingZone);
    playRollAnimationOnce(displayRoll, makeDisplaySticks(displayRoll), `fall:${seat.id}:${turnIndex}:${fallStartedAt}`, false, fallCount, timingZone);
    playSfx('roll');
    window.setTimeout(() => {
      rollInProgressRef.current = false;
      rollInProgressStartedAtRef.current = 0;
      setRollInProgress(false);
      setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
      addLog(`${getSeatDisplayName(seat)}님이 낙이 나와 차례를 넘깁니다.`);
      if (options.recordSequence !== false) {
        pendingSequenceMetaRef.current = { type: 'roll_yut', actorId: seat.id, clientMutationId: sourceAction && typeof sourceAction.payload?.clientActionId === 'string' ? sourceAction.payload.clientActionId : `roll_yut_fall:${seat.id}:${turnIndex}:${fallStartedAt}`, payload: { turnIndex, activeSeatId: seat.id, fallOccurred: true, rollTimingZone: timingZone }, action: sourceAction ?? null };
      }
    }, ROLL_ANIMATION_MS);
  }

  function reportTurnActionBlocked(type: 'roll_yut' | 'move_piece', reasons: string[], fallbackMessage: string) {
    const normalizedReasons = reasons.length ? reasons : ['unknown'];
    const messageText = `${fallbackMessage}: ${normalizedReasons.join(', ')}`;
    setLastActionDiagnostic({ type, message: messageText, reasons: normalizedReasons, createdAt: Date.now() });
    setMessage(messageText);
    setActionErrorDialog(messageText);
  }
  function reportTurnActionFailure(type: 'roll_yut' | 'move_piece', messageText: string, reasons: string[] = []) {
    setLastActionDiagnostic({ type, message: messageText, reasons, createdAt: Date.now() });
    setMessage(messageText);
    setActionErrorDialog(messageText);
  }
  function recordRemoteActionDiagnostic(type: 'roll_yut' | 'move_piece', stage: string, messageText: string, params: { status?: string; actionKey?: string } = {}) {
    const entry = {
      type,
      stage,
      status: params.status,
      message: messageText,
      actionKey: params.actionKey,
      createdAt: Date.now(),
      sequence: lastAppliedSequenceRef.current,
      turnIndex,
    };
    if ((params.status === 'rejected' || params.status === 'unsupported') && params.actionKey) {
      rejectedRemoteActionKeysRef.current.add(params.actionKey);
    }
    setRemoteActionDiagnostics((current) => [entry, ...current].slice(0, 20));
    setLastActionDiagnostic({ type, message: messageText, reasons: [stage, params.status].filter((value): value is string => Boolean(value)), createdAt: entry.createdAt });
  }

  function enqueueAuthoritativeGameAction(
    roomId: string,
    action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>,
    handleResult: (result: Awaited<ReturnType<typeof commitAuthoritativeGameAction>>) => Promise<void> | void,
    handleError: (error: unknown) => void,
    handleFinally: () => void,
  ) {
    const runCommit = async () => {
      try {
        const result = await commitAuthoritativeGameAction(roomId, action);
        await handleResult(result);
      } catch (error) {
        handleError(error);
      } finally {
        handleFinally();
      }
    };
    const queuedCommit = localActionCommitQueueRef.current.then(runCommit, runCommit);
    localActionCommitQueueRef.current = queuedCommit.catch(() => undefined);
  }

  function canSubmitDeadlineRecovery() {
    return Boolean(activeRoomId && screen === 'game' && isOnlinePlayer && !isSpectator && activeSeat && !winner && !activeTurnOrderIntro && !turnOrderPhase.active && !pendingTrapPlacement);
  }

  async function recoverTimedOutRoll(recoveryKey: string, options: { source?: string } = {}) {
    if (!canSubmitDeadlineRecovery() || onlineAuthoritativeGameStatePending || !activeRoomId || !activeSeat || roll || rollInProgress || rollAnimation || movingPieceId || moveInProgress) return false;
    if (timeoutRecoveryKeysRef.current.has(recoveryKey)) return false;
    timeoutRecoveryKeysRef.current.add(recoveryKey);
    const rollTimingZone: RollTimingZone = 'normal';
    const forcedResult = rollYutResultWithTiming(rollTimingZone).result;
    const actionKey = `roll_timeout:${recoveryKey}`;
    const action = {
      type: 'roll_yut' as const,
      actorId: activeSeat.id,
      payload: withActorLogPayload({
        forcedResult,
        rollTimingZone,
        timedOut: true,
        timeoutRecoveredBy: localSeatId,
        timeoutSource: options.source ?? 'deadline',
        clientActionId: actionKey,
      }, activeSeat),
    };
    recordRemoteActionDiagnostic('roll_yut', 'turn-roll-timeout-recovery-started', `${getSeatDisplayName(activeSeat)}님의 윷 던지기 제한 시간이 지나 자동 진행합니다.`, { actionKey });
    enqueueAuthoritativeGameAction(
      activeRoomId,
      action,
      async (result) => {
        if ((result.status === 'committed' || result.status === 'duplicate') && result.sequence) {
          const localSequence = lastAppliedSequenceRef.current;
          const resultSequence = result.sequence;
          if (resultSequence > localSequence) {
            const sequences = await getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence));
            const latestState = [...sequences]
              .filter((sequence) => Number(sequence.sequence ?? 0) <= resultSequence)
              .reverse()
              .find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
            if (latestState) await replayMissingSequencesThenApply(latestState, localSequence, resultSequence);
          }
          recordRemoteActionDiagnostic('roll_yut', 'turn-roll-timeout-recovery-committed', '윷 던지기 제한 시간 초과를 자동 처리했습니다.', { status: result.status, actionKey });
        }
        if (result.status === 'rejected' || result.status === 'unsupported') {
          recordRemoteActionDiagnostic('roll_yut', 'turn-roll-timeout-recovery-result', result.reason ?? '윷 던지기 자동 진행에 실패했습니다.', { status: result.status, actionKey });
        }
      },
      (error) => recordRemoteActionDiagnostic('roll_yut', 'turn-roll-timeout-recovery-error', error instanceof Error ? error.message : '윷 던지기 자동 진행에 실패했습니다.', { actionKey }),
      () => undefined,
    );
    return true;
  }

  async function recoverStalledTurnMove(recoveryKey: string, options: { source?: string } = {}) {
    if (!activeRoomId || onlineAuthoritativeGameStatePending || !canSubmitDeadlineRecovery() || !activeSeat || !roll || !stalledTurnFallbackPiece) return false;
    if (stalledTurnRecoveryKeyRef.current === recoveryKey) return false;
    if (winner || rollResultHolding || rollAnimation || movingPieceId || moveInProgress || pendingTrapPlacement) return false;
    if (stalledTurnNeedsBranchChoice) return false;

    stalledTurnRecoveryKeyRef.current = recoveryKey;
    const payload = {
      pieceId: stalledTurnFallbackPiece.id,
      extraSteps: 0,
      branchChoice: getEffectiveBranchChoice(stalledTurnFallbackPiece.nodeId, 'outer'),
      clientActionId: `move_piece_recovery:${recoveryKey}:${stalledTurnFallbackPiece.id}`,
      recoveredByCoordinator: true,
      coordinatorSeatId: localSeatId,
      reason: options.source === 'manual-sync' ? 'manual-sync-stalled-roll-move-timeout' : 'stalled-roll-move-timeout',
      stalledForMs: getCurrentStalledTurnSyncAgeMs(),
    };
    const action = { type: 'move_piece' as const, actorId: activeSeat.id, payload: withActorLogPayload(payload, activeSeat) };
    recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-started', `${getSeatDisplayName(activeSeat)}님의 멈춘 이동을 자동 복구합니다.`, { actionKey: payload.clientActionId });
    enqueueAuthoritativeGameAction(
      activeRoomId,
      action,
      async (result) => {
        if ((result.status === 'committed' || result.status === 'duplicate') && result.sequence) {
          const localSequence = lastAppliedSequenceRef.current;
          const resultSequence = result.sequence;
          if (resultSequence > localSequence) {
            const sequences = await getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence));
            const latestState = [...sequences]
              .filter((sequence) => Number(sequence.sequence ?? 0) <= resultSequence)
              .reverse()
              .find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
            if (latestState) await replayMissingSequencesThenApply(latestState, localSequence, resultSequence);
          }
          recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-committed', '멈춘 턴 이동을 자동 복구했습니다.', { status: result.status, actionKey: payload.clientActionId });
        }
        if (result.status === 'rejected' || result.status === 'unsupported') {
          recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-result', result.reason ?? '멈춘 턴 자동 복구에 실패했습니다.', { status: result.status, actionKey: payload.clientActionId });
        }
      },
      (error) => recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-error', error instanceof Error ? error.message : '멈춘 턴 자동 복구에 실패했습니다.', { actionKey: payload.clientActionId }),
      () => undefined,
    );
    return true;
  }

  useEffect(() => {
    if (canRollNow && !roll) rollTimingStartedAtRef.current = Date.now();
  }, [canRollNow, roll, turnIndex]);

  useEffect(() => {
    if (!rollTimingFeedback) return undefined;
    const timer = window.setTimeout(() => setRollTimingFeedback(null), 1200);
    return () => window.clearTimeout(timer);
  }, [rollTimingFeedback]);


  useEffect(() => {
    if (!stackedRollMode || !rollStackClosed || rollStack.length === 0) return;
    const nextIndex = rollStack.length === 1 ? 0 : selectedRollStackIndex;
    if (typeof nextIndex !== 'number' || !rollStack[nextIndex]) {
      if (roll) clearRoll();
      return;
    }
    if (selectedRollStackIndex !== nextIndex) setSelectedRollStackIndex(nextIndex);
    if (!roll || roll.name !== rollStack[nextIndex].name || roll.steps !== rollStack[nextIndex].steps) {
      currentRollRef.current = rollStack[nextIndex];
      setRoll(rollStack[nextIndex]);
      setRollResultReadyAt(0);
    }
  }, [rollStack, rollStackClosed, roll, selectedRollStackIndex, stackedRollMode]);

  useEffect(() => {
    if (!fallEffect) return undefined;
    const timer = window.setTimeout(() => setFallEffect(null), 1400);
    return () => window.clearTimeout(timer);
  }, [fallEffect]);

  function getCurrentRollTimingZone(positionPercent?: number) {
    return getRollTimingZone(positionPercent ?? getRollTimingPositionPercent(Date.now() - rollTimingStartedAtRef.current));
  }

  function rollYut(options: { timedOut?: boolean; timingPositionPercent?: number } | number = {}) {
    const rollOptions = typeof options === 'number' ? { timingPositionPercent: options } : options;
    if (screen === 'game' && !activeRoomId) {
      reportTurnActionFailure('roll_yut', '온라인 방 정보가 없어 진행할 수 없습니다.');
      return;
    }
    if (!activeSeat || !canRollNow) {
      reportTurnActionBlocked('roll_yut', rollActionBlockReasons, '윷 던지기를 진행할 수 없습니다');
      return;
    }
    if (!rollOptions.timedOut) clearTurnActionTimeoutPenalty(activeSeat.id);
    const rollTimingZone = rollOptions.timedOut ? 'normal' : getCurrentRollTimingZone(rollOptions.timingPositionPercent);
    setRollTimingFeedback(rollTimingZone);
    const fallOccurred = !forcedRoll && shouldFallForTimingZone(rollTimingZone);
    if (activeRoomId) {
      const localRoll = forcedRoll ?? rollYutResultWithTiming(rollTimingZone).result;
      const rollPayload = { forcedResult: localRoll, rollTimingZone, fallOccurred, stackedRollMode };
      const actionKey = `${getLocalActionKey('roll_yut', rollPayload)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      if (pendingLocalRemoteActionsRef.current.has(actionKey)) {
        reportTurnActionBlocked('roll_yut', ['pending-local-remote-action'], '이미 윷 던지기 요청을 처리 중입니다');
        return;
      }
      addPendingLocalRemoteAction(actionKey);
      localClientMutationIdsRef.current.add(actionKey);
      const action = { type: 'roll_yut' as const, actorId: localSeatId, payload: withActorLogPayload({ ...rollPayload, clientActionId: actionKey }, activeSeat) };
      const optimisticRoll = fallOccurred ? null : stackedRollMode ? rollYutForStack(activeSeat, localRoll, action, { recordSequence: false, timingZone: rollTimingZone }) : rollYutFor(activeSeat, localRoll, action, { recordSequence: false, timingZone: rollTimingZone });
      if (fallOccurred) {
        setRollStack([]);
        setSelectedRollStackIndex(null);
        setRollStackClosed(false);
        applyLocalFall(activeSeat, rollTimingZone, localRoll, action, { recordSequence: false });
      }
      if (!fallOccurred && !optimisticRoll) {
        deletePendingLocalRemoteAction(actionKey);
        localClientMutationIdsRef.current.delete(actionKey);
        reportTurnActionBlocked('roll_yut', ['roll-in-progress'], '윷 던지기를 진행할 수 없습니다');
        return;
      }

      const finishPendingRoll = () => {
        deletePendingLocalRemoteAction(actionKey);
      };

      enqueueAuthoritativeGameAction(
        activeRoomId,
        action,
        (result) => {
          if (result.status === 'rejected' || result.status === 'unsupported') {
            recordRemoteActionDiagnostic('roll_yut', 'commit-result', result.reason ?? '윷 던지기 처리에 실패했습니다.', { status: result.status, actionKey });
            return;
          }
          if ((result.status === 'committed' || result.status === 'duplicate') && result.sequence) {
            lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.sequence);
            if (result.turnVersion) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, result.turnVersion);
            acknowledgePendingLocalRemoteAction(actionKey);
          }
          if (result.status === 'committed') {
            const committedFallEffect = result.patch?.fallEffect as FallEffect | null | undefined;
            if (committedFallEffect) setFallEffect(committedFallEffect);
            const committedRoll = result.patch?.roll as YutResult | null | undefined;
            const committedRollStack = result.patch?.rollStack as YutResult[] | undefined;
            if (committedRollStack) {
              setRollStack(committedRollStack);
              setSelectedRollStackIndex(typeof result.patch?.selectedRollStackIndex === 'number' ? result.patch.selectedRollStackIndex as number : null);
              setRollStackClosed(Boolean(result.patch?.rollStackClosed));
            }
            const committedRollResultReadyAt = normalizeRollResultReadyAt(Number(result.patch?.rollResultReadyAt ?? 0));
            if (committedRoll && optimisticRoll && (committedRoll.name !== optimisticRoll.name || committedRoll.steps !== optimisticRoll.steps)) {
              recordRemoteActionDiagnostic('roll_yut', 'optimistic-mismatch', '서버 윷 결과가 로컬 선반영 결과와 달라 최신 상태를 동기화합니다.', { status: result.status, actionKey });
            }
            if (committedRoll && !currentRollRef.current) {
              currentRollRef.current = committedRoll;
              setRoll(committedRoll);
              setRollResultReadyAt(committedRollResultReadyAt);
              playRollAnimationOnce(committedRoll, makeDisplaySticks(committedRoll), `${turnIndex}:${committedRoll.name}:${committedRoll.steps}:${committedRollResultReadyAt}`, false, 0, (result.patch?.lastRollTimingZone as RollTimingZone | null | undefined) ?? undefined);
              playSfx('roll');
              if (committedRoll.bonus) window.setTimeout(() => playSfx('bonus'), 420);
            }
          }
        },
        (error) => recordRemoteActionDiagnostic('roll_yut', 'commit-error', error instanceof Error ? error.message : '윷 던지기 처리에 실패했습니다.', { actionKey }),
        finishPendingRoll,
      );
      return;
    }
    if (fallOccurred) {
      setRollStack([]);
      setSelectedRollStackIndex(null);
      setRollStackClosed(false);
      applyLocalFall(activeSeat, rollTimingZone, forcedRoll ?? rollYutResultWithTiming(rollTimingZone).result);
      return;
    }
    setShieldedPieceIds([]);
    const localRoll = forcedRoll ?? rollYutResultWithTiming(rollTimingZone).result;
    if (stackedRollMode) rollYutForStack(activeSeat, localRoll, null, { timingZone: rollTimingZone });
    else rollYutFor(activeSeat, localRoll, null, { timingZone: rollTimingZone });
  }

  async function movePiece(pieceId: string, result: YutResult, seat: Seat, extraSteps = 0, branchOverride: BranchChoice = branchChoice, options: { recordSequence?: boolean; consumeStackedRollIndex?: number; rollStackSnapshot?: YutResult[]; consumedItemType?: ItemType } = {}) {
    if (winner || movingPieceId || moveInProgressRef.current) return false;
    ensureRollLogExists(seat, result);
    setMoveInProgressState(true);
    const currentPieces = piecesRef.current;
    const movingPiece = currentPieces.find((piece) => piece.id === pieceId && canSeatControlPiece(seat, piece) && !piece.finished);
    if (!movingPiece) { setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1)); clearRoll(); setMoveInProgressState(false); return false; }
    const steps = result.steps + extraSteps;
    if (steps < 0 && !movingPiece.started) {
      addLog(`${getSeatDisplayName(seat)}님은 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
      setBranchChoice('outer');
      clearRoll();
      setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
      setMoveInProgressState(false);
      return false;
    }
    if (steps === 0) {
      addLog(`${getSeatDisplayName(seat)}님의 말은 이동할 칸 수가 없어 제자리에 머뭅니다.`);
      setBranchChoice('outer');
      clearRoll();
      setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
      setMoveInProgressState(false);
      return true;
    }
    setMovingPieceId(pieceId);
    const movingGroupIds = movingPiece.started
      ? currentPieces.filter((piece) => canSeatControlPiece(seat, piece) && !piece.finished && piece.started && piece.nodeId === movingPiece.nodeId).map((piece) => piece.id)
      : [movingPiece.id];
    if (!movingPiece.started) await delay(STEP_DELAY_MS);
    let nextNodeIndex = movingPiece.nodeIndex;
    let currentNodeId = movingPiece.nodeId;
    let finishedMove = false;
    const movePathNodeIds = getMovePathNodeIdsWithPrevious(currentNodeId, steps, getEffectiveBranchChoice(currentNodeId, branchOverride), movingPiece.previousNodeId);
    for (let step = 0; step < Math.abs(steps); step += 1) {
      if (steps > 0 && movingPiece.started && currentNodeId === 'n01') {
        currentNodeId = 'finish';
        nextNodeIndex = 20;
        finishedMove = true;
        setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: nextNodeIndex, nodeId: currentNodeId, started: true, finished: true } : piece));
        await delay(STEP_DELAY_MS);
        break;
      }
      const nextNodeId = movePathNodeIds[step];
      if (!nextNodeId) {
        currentNodeId = 'n01';
        nextNodeIndex = 0;
        setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: nextNodeIndex, nodeId: currentNodeId, started: true, finished: false } : piece));
        await delay(STEP_DELAY_MS);
        currentNodeId = 'finish';
        nextNodeIndex = 20;
        finishedMove = true;
        setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: nextNodeIndex, nodeId: currentNodeId, started: true, finished: true } : piece));
        await delay(STEP_DELAY_MS);
        break;
      }
      const previousNodeId = currentNodeId;
      currentNodeId = nextNodeId;
      nextNodeIndex = BOARD_NODES.findIndex((node) => node.id === nextNodeId);
      setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: nextNodeIndex, nodeId: currentNodeId, started: true, finished: false, previousNodeId } : piece));
      playSfx('move');
      await delay(STEP_DELAY_MS);
    }

    const landedNode = getBoardNodeById(currentNodeId);
    const landedItem = boardItems.find((item) => item.nodeId === landedNode?.id);
    let itemPickupWait: Promise<void> | null = null;
    if (landedItem) {
      const itemName = ITEM_DEFINITIONS[landedItem.type].name;
      const currentItems = ownedItems[seat.id] ?? [];
      const currentItemsAfterConsumedItem = options.consumedItemType
        ? currentItems.filter((type, index) => type !== options.consumedItemType || index !== currentItems.indexOf(options.consumedItemType))
        : currentItems;
      const sameTimingItem = findItemWithSameTiming(currentItemsAfterConsumedItem, landedItem.type);
      if (sameTimingItem && seat.id === localSeatId && !seat.isAI) {
        itemPickupWait = new Promise<void>((resolve) => { pendingItemPickupResolverRef.current = resolve; });
        setPendingItemPickup({ seatId: seat.id, item: landedItem.type, itemId: landedItem.id, existingItem: sameTimingItem, deadline: Date.now() + ITEM_REPLACE_TIMEOUT_MS });
        addLog(`${getSeatDisplayName(seat)}님이 아이템 '${itemName}'을 발견했습니다. 같은 사용 조건의 아이템과 교체할지 선택해야 합니다.`);
      } else if (sameTimingItem && seat.isAI && getAiItemValue(landedItem.type) > getAiItemValue(sameTimingItem)) {
        setOwnedItems((items) => ({ ...items, [seat.id]: (items[seat.id] ?? []).map((type) => type === sameTimingItem ? landedItem.type : type) }));
        setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
        addLog(`${getSeatDisplayName(seat)}님이 아이템 '${ITEM_DEFINITIONS[sameTimingItem].name}'을 '${itemName}'으로 교체했습니다.`);
      } else if (sameTimingItem) {
        setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
        addLog(`${getSeatDisplayName(seat)}님이 아이템 '${itemName}'을 발견했지만 같은 사용 조건의 아이템을 유지했습니다.`);
      } else {
        setOwnedItems((items) => ({ ...items, [seat.id]: [...(items[seat.id] ?? []), landedItem.type] }));
        setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
        addLog(`${getSeatDisplayName(seat)}님이 아이템 '${itemName}'을 획득했습니다.`);
      }
      setRevealedItems((items) => Array.from(new Set([...items, landedItem.type])));
      const toastWait = showToast(itemName, ITEM_DEFINITIONS[landedItem.type].description, ITEM_DEFINITIONS[landedItem.type].icon);
      itemPickupWait = itemPickupWait ? Promise.all([itemPickupWait, toastWait]).then(() => undefined) : toastWait;
      playSfx('itemPickup');
      setHighlightedNodeId(landedNode?.id ?? '');
      window.setTimeout(() => setHighlightedNodeId((current) => current === landedNode?.id ? '' : current), 1400);
    }
    const steppedOnTrap = trapNodes.find((trap) => trap.nodeId === currentNodeId && !isSameSide(getSeatById(trap.ownerId), seat));
    if (steppedOnTrap) {
      setTrapNodes((nodes) => nodes.filter((trap) => trap !== steppedOnTrap));
      const shieldedFromTrap = movingGroupIds.some((id) => shieldedPieceIds.includes(id));
      if (shieldedFromTrap) {
        setShieldedPieceIds((ids) => ids.filter((id) => !movingGroupIds.includes(id)));
        addLog(`${getSeatDisplayName(seat)}님의 말이 방패로 함정을 막았습니다.`);
        playSfx('shield');
      } else {
        const effect = { id: Date.now(), nodeId: currentNodeId, pieceIds: movingGroupIds };
        setTrapEffect(effect);
        addLog(`${getSeatDisplayName(seat)}님의 말이 함정을 밟아 폭발했습니다. 잠시 후 시작점으로 돌아갑니다.`);
        playSfx('trap');
        await delay(TRAP_EFFECT_MS);
        setTrapEffect((current) => current?.id === effect.id ? null : current);
        setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: undefined } : piece));
        currentNodeId = 'n01';
        nextNodeIndex = 0;
        await delay(STEP_DELAY_MS);
      }
    }
    let captured = false;
    if (currentNodeId !== 'finish') {
      const capturablePieces = piecesRef.current.filter((piece) => !isSameSide(getSeatById(piece.ownerId), seat) && !piece.finished && piece.started && piece.nodeId === currentNodeId);
      const shieldedCaptures = capturablePieces.filter((piece) => shieldedPieceIds.includes(piece.id));
      captured = capturablePieces.some((piece) => !shieldedPieceIds.includes(piece.id));
      if (shieldedCaptures.length) {
        setShieldedPieceIds((ids) => ids.filter((id) => !shieldedCaptures.some((piece) => piece.id === id)));
        addLog('방패가 상대의 잡기를 1회 막았습니다.');
      }
      if (captured) {
        const capturedPieces = capturablePieces.filter((piece) => !shieldedPieceIds.includes(piece.id));
        const capturedPieceIds = capturedPieces.map((piece) => piece.id);
        const capturedOwnerCounts = capturedPieces.reduce<Record<string, number>>((counts, piece) => {
          counts[piece.ownerId] = (counts[piece.ownerId] ?? 0) + 1;
          return counts;
        }, {});
        Object.entries(capturedOwnerCounts).forEach(([ownerId, count]) => {
          const ownerSeat = getSeatById(ownerId);
          addLog(`${getSeatDisplayName(seat)}님이 ${ownerSeat ? getSeatDisplayName(ownerSeat) : ownerId}님의 말 ${count}개를 잡았습니다.`);
        });
        const effect = { id: Date.now(), pieceIds: capturedPieceIds };
        setCaptureEffect(effect);
        playSfx('capture');
        await delay(STEP_DELAY_MS * 2);
        setPieces((currentPieces) => currentPieces.map((piece) => capturedPieceIds.includes(piece.id) ? { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, previousNodeId: undefined } : piece));
        window.setTimeout(() => setCaptureEffect((current) => current?.id === effect.id ? null : current), 450);
      }
    }
    if (finishedMove) { addLog(`${getSeatDisplayName(seat)}님의 말이 완주했습니다!`); playSfx('arrive'); }
    const controlledPiecesDone = piecesRef.current.filter((piece) => canSeatControlPiece(seat, piece) && piece.id !== pieceId).every((piece) => piece.finished) && finishedMove;
    if (controlledPiecesDone) addLog(`${playMode === 'team' ? seat.team : getSeatDisplayName(seat)}님의 모든 말이 완주했습니다.`);
    const consumingStackedRoll = stackedRollMode && typeof options.consumeStackedRollIndex === 'number';
    const sourceRollStack = options.rollStackSnapshot ?? rollStack;
    const remainingRollStack = consumingStackedRoll ? sourceRollStack.filter((_, index) => index !== options.consumeStackedRollIndex) : sourceRollStack;
    let shouldAdvanceTurn = false;
    if (consumingStackedRoll) {
      shouldAdvanceTurn = remainingRollStack.length === 0 && !captured;
      if (captured) addLog('상대 말을 잡아 한 번 더 던질 수 있습니다.');
    } else if (result.bonus && captured) addLog(`${withAndParticle(result.name)} 잡기 보너스로 한 번 더 던질 수 있습니다.`);
    else if (result.bonus) addLog(`${withSubjectParticle(result.name)} 나와 한 번 더 던질 수 있습니다.`);
    else if (captured) addLog('상대 말을 잡아 한 번 더 던질 수 있습니다.');
    else shouldAdvanceTurn = true;
    const canPromptMoveAdjustmentItem = !shouldAdvanceTurn
      && seat.id === localSeatId
      && !seat.isAI
      && currentNodeId !== 'finish'
      && movingGroupIds.some((id) => piecesRef.current.some((piece) => piece.id === id && canSeatControlPiece(seat, piece) && piece.started && !piece.finished));
    const hasMoveAdjustmentItem = (ownedItems[localSeatId] ?? []).some((type) => type === 'move_plus_one' || type === 'move_minus_one')
      || (!itemPickupWait && landedItem && (landedItem.type === 'move_plus_one' || landedItem.type === 'move_minus_one'));
    if (shouldAdvanceTurn && itemPickupWait) await itemPickupWait;
    if (shouldAdvanceTurn) setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
    setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);
    setTurnDeadlineKind('roll');
    setLastMovedPieceIds(movingGroupIds);
    setLastMovedSeatId(seat.id);
    if (canPromptMoveAdjustmentItem && hasMoveAdjustmentItem) setItemPromptTiming('after_move');
    setBranchChoice('outer');
    clearRoll();
    if (consumingStackedRoll) {
      setRollStack(remainingRollStack);
      setRollStackClosed(captured ? false : remainingRollStack.length > 0);
      setSelectedRollStackIndex(!captured && remainingRollStack.length === 1 ? 0 : null);
      if (!captured && remainingRollStack.length === 1) {
        currentRollRef.current = remainingRollStack[0];
        setRoll(remainingRollStack[0]);
      }
    }
    setMovingPieceId('');
    setMoveInProgressState(false);
    if (activeRoomId && canCoordinateOnlineGame && options.recordSequence !== false) {
      const nextTurnIndex = shouldAdvanceTurn ? (turnIndex + 1) % Math.max(turnSeats.length, 1) : turnIndex;
      const clientMutationId = `move_piece:${seat.id}:${lastAppliedSequenceRef.current}:${turnIndex}:${pieceId}:${Date.now()}`;
      pendingSequenceMetaRef.current = {
        type: 'move_piece_resolved',
        actorId: seat.id,
        clientMutationId,
        payload: {
          activeSeatId: seat.id,
          pieceId,
          rollName: result.name,
          rollSteps: result.steps,
          extraSteps,
          totalSteps: steps,
          branchChoice: getEffectiveBranchChoice(movingPiece.nodeId, branchOverride),
          fromNodeId: movingPiece.nodeId,
          toNodeId: currentNodeId,
          pathNodeIds: movePathNodeIds,
          movingGroupIds,
          nextTurnIndex,
          extraTurn: consumingStackedRoll ? remainingRollStack.length > 0 : nextTurnIndex === turnIndex,
          remainingRollStack,
          extraTurnReasons: [result.bonus ? 'roll_bonus' : '', captured ? 'capture' : ''].filter(Boolean),
        },
        action: null,
      };
      setCoordinatorStateSaveKey((current) => current || clientMutationId);
    }
    return true;
  }

  function moveSelectedPiece(extraSteps = 0, options: { timedOut?: boolean } = {}) {
    if (screen === 'game' && !activeRoomId) {
      reportTurnActionFailure('move_piece', '온라인 방 정보가 없어 진행할 수 없습니다.');
      return false;
    }
    const effectiveMoveRoll = stackedRollSelectedResult ?? roll;
    const steps = effectiveMoveRoll && activeSeat ? effectiveMoveRoll.steps + extraSteps : 0;
    const canMovePiece = (piece: BoardPiece) => steps >= 0 || piece.started;
    const canPassBackDoWithoutMovablePiece = Boolean(effectiveMoveRoll && activeSeat && canSubmitTurnAction && steps < 0 && !pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece)));
    if (!(roll || stackedRollSelectedResult) || !activeSeat || (!canRequestMove && !canPassBackDoWithoutMovablePiece)) {
      reportTurnActionBlocked('move_piece', moveActionBlockReasons, '말 이동을 진행할 수 없습니다');
      return false;
    }
    if (!options.timedOut) clearTurnActionTimeoutPenalty(activeSeat.id);
    const movablePieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece));
    const hasPieceOnBoard = pieces.some((piece) => canSeatControlPiece(activeSeat, piece) && piece.started && !piece.finished);
    const selectedPiece = hasPieceOnBoard ? movablePieces.find((piece) => piece.id === selectedPieceId) : undefined;
    const fallbackPiece = hasPieceOnBoard ? movablePieces[0] : [...movablePieces].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }))[0];
    if ((!selectedPiece || !hasPieceOnBoard) && fallbackPiece) setSelectedPieceId(fallbackPiece.id);
    if (!selectedPiece && !fallbackPiece) {
      if (steps < 0) {
        addLog(`${getSeatDisplayName(activeSeat)}님은 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
        setBranchChoice('outer');
        clearRoll();
        setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
      }
      return false;
    }
    const pieceToMove = selectedPiece ?? fallbackPiece;
    if (!effectiveMoveRoll) return false;
    if (activeRoomId) {
      const payload = {
        pieceId: pieceToMove?.id ?? '',
        extraSteps,
        branchChoice: getEffectiveBranchChoice(pieceToMove?.nodeId ?? '', displayBranchChoice),
        rollStackIndex: stackedRollMode && rollStackClosed ? selectedRollStackIndex ?? (rollStack.length === 1 ? 0 : null) : null,
      };
      const actionKey = getLocalActionKey('move_piece', payload);
      if (rejectedRemoteActionKeysRef.current.has(actionKey)) {
        reportTurnActionBlocked('move_piece', ['previously-rejected-remote-action'], '서버가 같은 말 이동 요청을 이미 거부했습니다. 동기화 후 다시 시도해주세요');
        return false;
      }
      if (pendingLocalRemoteActionsRef.current.has(actionKey)) {
        reportTurnActionBlocked('move_piece', ['pending-local-remote-action'], '이미 말 이동 요청을 처리 중입니다');
        return false;
      }
      addPendingLocalRemoteAction(actionKey);
      localClientMutationIdsRef.current.add(actionKey);
      const action = { type: 'move_piece' as const, actorId: localSeatId, payload: withActorLogPayload({ ...payload, clientActionId: actionKey }, activeSeat) };
      void movePiece(pieceToMove?.id ?? selectedPieceId, effectiveMoveRoll, activeSeat, extraSteps, getEffectiveBranchChoice(pieceToMove?.nodeId ?? '', displayBranchChoice), { recordSequence: false, consumeStackedRollIndex: stackedRollMode && rollStackClosed ? selectedRollStackIndex ?? (rollStack.length === 1 ? 0 : undefined) : undefined });
      enqueueAuthoritativeGameAction(
        activeRoomId,
        action,
        async (result) => {
          if ((result.status === 'committed' || result.status === 'duplicate') && result.sequence) {
            const localSequence = lastAppliedSequenceRef.current;
            const resultSequence = result.sequence;
            if (resultSequence > localSequence) {
              const sequences = await getGameSequencesSince(activeRoomId, getSequenceRefetchAfter(localSequence));
              const latestState = [...sequences]
                .filter((sequence) => Number(sequence.sequence ?? 0) <= resultSequence)
                .reverse()
                .find((sequence) => sequence.stateAfter)?.stateAfter as SequenceStateSnapshot | undefined;
              if (latestState) await replayMissingSequencesThenApply(latestState, localSequence, resultSequence);
            }
            acknowledgePendingLocalRemoteAction(actionKey);
          }
          if (result.status === 'rejected' || result.status === 'unsupported') {
            recordRemoteActionDiagnostic('move_piece', 'commit-result', result.reason ?? '말 이동 처리에 실패했습니다.', { status: result.status, actionKey });
          }
        },
        (error) => recordRemoteActionDiagnostic('move_piece', 'commit-error', error instanceof Error ? error.message : '말 이동 처리에 실패했습니다.', { actionKey }),
        () => deletePendingLocalRemoteAction(actionKey),
      );
      return true;
    }
    void movePiece(pieceToMove?.id ?? selectedPieceId, effectiveMoveRoll, activeSeat, extraSteps, getEffectiveBranchChoice(pieceToMove?.nodeId ?? '', displayBranchChoice));
    return true;
  }

  function getPostMoveAdjustmentPiece(seat: Seat | undefined) {
    if (!seat || lastMovedSeatId !== seat.id) return undefined;
    return lastMovedPieceIds
      .map((id) => pieces.find((piece) => piece.id === id && canSeatControlPiece(seat, piece) && piece.started && !piece.finished))
      .find((piece): piece is BoardPiece => Boolean(piece));
  }

  function getAiMoveContext() {
    return { canSeatControlPiece, getSeatById, isSameSide, pieces: piecesRef.current };
  }

  function doesAiMoveCapture(seat: Seat, piece: BoardPiece, result: YutResult, aiBranchChoice: BranchChoice) {
    const currentPieces = piecesRef.current;
    const pathNodeIds = getMovePathNodeIds(piece.nodeId, result.steps, getEffectiveBranchChoice(piece.nodeId, aiBranchChoice));
    const landedNodeId = pathNodeIds[pathNodeIds.length - 1] ?? piece.nodeId;
    const finishes = result.steps > 0 && piece.started && pathNodeIds.slice(0, result.steps - 1).includes('n01');
    return !finishes && currentPieces.some((target) => !isSameSide(getSeatById(target.ownerId), seat) && target.started && !target.finished && target.nodeId === landedNodeId);
  }

  async function useAiAfterMoveItem(seat: Seat) {
    const item = chooseAiAfterMoveItem({ adjustmentPiece: getPostMoveAdjustmentPiece(seat), items: ownedItems[seat.id] ?? [] });
    if (!item) return false;
    await useItem(item, seat.id);
    return true;
  }

  async function autoPlayTurn(seat: Seat, actionKey = `${seat.id}:${turnIndex}`) {
    const canContinueAiTurn = () => {
      const guard = liveTurnGuardRef.current;
      return seat.isAI && guard.activeSeatId === seat.id && !guard.winner && !guard.movingPieceId && !guard.pendingTrapPlacement && !guard.turnOrderActive && !guard.turnOrderIntro;
    };
    const clearCurrentAiActionKey = () => {
      if (aiTurnActionKeyRef.current === actionKey) aiTurnActionKeyRef.current = '';
    };

    try {
      if (!canContinueAiTurn()) return;
      let nextRoll: YutResult | null = null;
      if ((ownedItems[seat.id] ?? []).includes('golden_yut')) {
        nextRoll = chooseAiGoldenYutResult(seat, getAiMoveContext());
        setOwnedItems((items) => ({ ...items, [seat.id]: (items[seat.id] ?? []).filter((type, index) => type !== 'golden_yut' || index !== (items[seat.id] ?? []).indexOf('golden_yut')) }));
        addLog(`${getSeatDisplayName(seat)}님이 황금 윷으로 ${nextRoll.name} 결과를 선택했습니다.`);
      }
      if (stackedRollMode) {
        const aiRollStack: YutResult[] = [];
        const rollAiStackUntilClosed = async (stack: YutResult[], forcedRoll: YutResult | null = null) => {
          let pendingForcedRoll = forcedRoll;
          do {
            const aiTimingZone = chooseAiRollTimingZone();
            setRollTimingFeedback(aiTimingZone);
            const stackedRoll = pendingForcedRoll ?? rollYutResultWithTiming(aiTimingZone).result;
            pendingForcedRoll = null;
            if (!rollYutForStack(seat, stackedRoll, null, { timingZone: aiTimingZone })) return false;
            stack.push(stackedRoll);
            await delay(ROLL_ANIMATION_MS + 120);
          } while (stack[stack.length - 1]?.bonus && canContinueAiTurn());
          return true;
        };
        if (!await rollAiStackUntilClosed(aiRollStack, nextRoll)) return;
        let remainingRolls = [...aiRollStack];
        let movedAtLeastOnce = false;
        while (remainingRolls.length && canContinueAiTurn()) {
          const rankedMoves = remainingRolls
            .map((stackRoll, index) => ({ stackRoll, index, move: chooseAiMove(seat, stackRoll, getAiMoveContext()) }))
            .filter((entry): entry is { stackRoll: YutResult; index: number; move: NonNullable<ReturnType<typeof chooseAiMove>> } => Boolean(entry.move))
            .sort((left, right) => right.move.score - left.move.score);
          const selected = rankedMoves[0];
          if (!selected) {
            const skippedRoll = remainingRolls.shift();
            if (skippedRoll && skippedRoll.steps < 0) addLog(`${getSeatDisplayName(seat)}님은 판 위에 나온 말이 없어 ${skippedRoll.name}를 이동하지 못합니다.`);
            setRollStack([...remainingRolls]);
            setRollStackClosed(remainingRolls.length > 0);
            setSelectedRollStackIndex(remainingRolls.length === 1 ? 0 : null);
            if (remainingRolls.length === 0) setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
            continue;
          }
          setSelectedRollStackIndex(selected.index);
          setBranchChoice(selected.move.branchChoice);
          const earnsCaptureRoll = doesAiMoveCapture(seat, selected.move.piece, selected.stackRoll, selected.move.branchChoice);
          await delay(AI_MOVE_DELAY_MS);
          const moved = await movePiece(selected.move.piece.id, selected.stackRoll, seat, 0, selected.move.branchChoice, { consumeStackedRollIndex: selected.index, rollStackSnapshot: remainingRolls });
          movedAtLeastOnce = movedAtLeastOnce || moved;
          await delay(0);
          remainingRolls = remainingRolls.filter((_, index) => index !== selected.index);
          if (earnsCaptureRoll && canContinueAiTurn() && !await rollAiStackUntilClosed(remainingRolls)) return;
        }
        if (remainingRolls.length === 0 && movedAtLeastOnce && canContinueAiTurn()) await useAiAfterMoveItem(seat);
        return;
      }
      const aiTimingZone = chooseAiRollTimingZone();
      setRollTimingFeedback(aiTimingZone);
      nextRoll = rollYutFor(seat, nextRoll, null, { timingZone: aiTimingZone }) ?? nextRoll;
      if (!nextRoll) return;
      if ((ownedItems[seat.id] ?? []).includes('reroll') && shouldAiUseReroll(seat, nextRoll, getAiMoveContext())) {
        await useItem('reroll', seat.id);
        await delay(500);
        nextRoll = currentRollRef.current;
        if (!nextRoll) return;
      }
      const aiMove = chooseAiMove(seat, nextRoll, getAiMoveContext());
      if (!aiMove) {
        setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));
        clearRoll();
        return;
      }
      setBranchChoice(aiMove.branchChoice);
      await delay(AI_MOVE_DELAY_MS);
      if (!canContinueAiTurn()) return;
      await movePiece(aiMove.piece.id, nextRoll, seat, 0, aiMove.branchChoice);
      if (!canContinueAiTurn()) return;
      await useAiAfterMoveItem(seat);
    } finally {
      clearCurrentAiActionKey();
    }
  }

  function placePendingTrap(nodeId: string, actorId = localSeatId) {
    if (!pendingTrapPlacement || !pendingTrapPlacement.nodeIds.includes(nodeId)) return;
    const itemOwnerSeat = playableSeats.find((seat) => seat.id === pendingTrapPlacement.ownerId);
    const trapPiece = pieces.find((piece) => piece.id === pendingTrapPlacement.pieceId);
    if (!itemOwnerSeat || !trapPiece) { setPendingTrapPlacement(null); return; }
    if (activeRoomId && actorId === localSeatId) {
      const payload = { nodeId, pieceId: pendingTrapPlacement.pieceId };
      const clientMutationId = getLocalActionKey('place_trap', payload);
      pendingSequenceMetaRef.current = { type: 'trap_placed', actorId, clientMutationId, payload, action: { type: 'place_trap', actorId, payload: withActorLogPayload({ ...payload, clientActionId: clientMutationId }, itemOwnerSeat) } };
    }
    playSfx('itemUse');
    setOwnedItems((items) => {
      const nextSeatItems = [...(items[pendingTrapPlacement.ownerId] ?? [])];
      const trapIndex = nextSeatItems.indexOf('trap');
      if (trapIndex >= 0) nextSeatItems.splice(trapIndex, 1);
      return { ...items, [pendingTrapPlacement.ownerId]: nextSeatItems };
    });
    setTrapNodes((nodes) => [...nodes.filter((trap) => trap.nodeId !== nodeId), { nodeId, ownerId: pendingTrapPlacement.ownerId }]);
    addLog(`${getSeatDisplayName(itemOwnerSeat)}님이 ${trapPiece.label} 주변 ${nodeId} 칸에 함정을 설치했습니다.`);
    setPendingTrapPlacement(null);
  }

  async function useItem(type: ItemType, actorId = localSeatId, remotePayload: Record<string, unknown> = {}) {
    if (movingPieceId) return;
    const itemOwnerId = actorId;
    const itemOwnerSeat = playableSeats.find((seat) => seat.id === itemOwnerId);
    if (!itemOwnerSeat) return;
    const activeItems = ownedItems[itemOwnerId] ?? [];
    if (!activeItems.includes(type)) return;
    const itemActionPayload = { itemType: type, pieceId: selectedPieceId, branchChoice };
    const clientMutationId = getLocalActionKey('use_item', itemActionPayload);
    const submitItemActionIfRemote = () => undefined;
    if (activeRoomId && actorId === localSeatId) {
      pendingSequenceMetaRef.current = { type: 'item_used', actorId, clientMutationId, payload: itemActionPayload, action: { type: 'use_item', actorId, payload: withActorLogPayload({ ...itemActionPayload, clientActionId: clientMutationId }, itemOwnerSeat) } };
    }
    const consumeItem = () => { clearTurnActionTimeoutPenalty(itemOwnerId); playSfx('itemUse'); setItemPromptTiming(null); setPendingTrapPlacement(null); setOwnedItems((items) => { const nextSeatItems = [...(items[itemOwnerId] ?? [])]; nextSeatItems.splice(nextSeatItems.indexOf(type), 1); return { ...items, [itemOwnerId]: nextSeatItems }; }); };
    if (type === 'golden_yut') {
      if (activeSeat?.id !== itemOwnerId || roll) { addLog('황금 윷은 내 턴에 윷을 던지기 전에 사용할 수 있습니다.'); return; }
      submitItemActionIfRemote();
      consumeItem();
      if (actorId === localSeatId) {
        setGoldenYutPickerOpen(true);
        addLog('황금 윷을 사용했습니다. 다음 윷 결과를 선택하세요.');
      } else {
        addLog(`${getSeatDisplayName(itemOwnerSeat)}님이 황금 윷을 사용했습니다. 다음 윷 결과를 선택 중입니다.`);
      }
      return;
    }
    if (type === 'reroll') {
      if (activeSeat?.id !== itemOwnerId || !roll) { addLog('다시 던지기는 내 턴에 윷을 던진 뒤 사용할 수 있습니다.'); return; }
      submitItemActionIfRemote();
      consumeItem();
      clearRoll();
      window.setTimeout(() => rollYutFor(itemOwnerSeat), 450);
      return;
    }
    if (type === 'move_plus_one' || type === 'move_minus_one') {
      if (lastMovedSeatId !== itemOwnerId) { addLog('이동 보정 아이템은 내 말이 이동한 직후 사용할 수 있습니다.'); return; }
      submitItemActionIfRemote();
      const itemMoveSteps = type === 'move_plus_one' ? 1 : -1;
      const targetPiece = actorId === localSeatId
        ? getPostMoveAdjustmentPiece(itemOwnerSeat)
        : pieces.find((piece) => piece.id === String(remotePayload.pieceId ?? lastMovedPieceIds[0] ?? '') && canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished);
      const moved = targetPiece ? await movePiece(targetPiece.id, { name: '황금 윷', steps: 0, bonus: true }, itemOwnerSeat, itemMoveSteps, getEffectiveBranchChoice(targetPiece.nodeId, (remotePayload.branchChoice as BranchChoice | undefined) ?? branchChoice), { consumedItemType: type }) : false;
      if (!moved) return;
      consumeItem();
      return;
    }
    if (type === 'shield') {
      const shieldTargets = lastMovedSeatId === itemOwnerId ? lastMovedPieceIds.filter((id) => pieces.some((piece) => piece.id === id && canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished)) : [];
      if (!shieldTargets.length) { addLog('방패는 방금 이동한 내 말이 말판 위에 있을 때 사용할 수 있습니다.'); return; }
      submitItemActionIfRemote();
      consumeItem();
      setShieldedPieceIds((ids) => Array.from(new Set([...ids, ...shieldTargets])));
      addLog(`${getSeatDisplayName(itemOwnerSeat)}님의 방금 이동한 말에 방패를 씌웠습니다.`);
      return;
    }
    if (type === 'trap') {
      if (lastMovedSeatId !== itemOwnerId) { addLog('함정은 내 말이 이동한 직후에 설치할 수 있습니다.'); return; }
      const trapPieceId = actorId === localSeatId ? lastMovedPieceIds[0] : String(remotePayload.pieceId ?? lastMovedPieceIds[0] ?? '');
      const trapPiece = pieces.find((piece) => piece.id === trapPieceId && lastMovedPieceIds.includes(piece.id) && canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished);
      if (!trapPiece) { addLog('함정은 방금 이동한 말이 말판 위에 있을 때 사용할 수 있습니다.'); return; }
      if (activeRoomId && actorId === localSeatId && pendingSequenceMetaRef.current) {
        pendingSequenceMetaRef.current = { ...pendingSequenceMetaRef.current, payload: { ...itemActionPayload, pieceId: trapPiece.id } };
      }
      const nodeIds = getNearbyNodeIds(trapPiece.nodeId, 1).filter((nodeId) => nodeId !== 'n01');
      if (!nodeIds.length) { addLog('함정을 설치할 수 있는 칸이 없습니다.'); return; }
      submitItemActionIfRemote();
      if (itemOwnerSeat.isAI) {
        const selectedNodeId = nodeIds
          .map((nodeId) => ({ nodeId, score: pieces.filter((piece) => !canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished).some((piece) => getMovePathNodeIds(piece.nodeId, 5, 'outer').includes(nodeId)) ? 10 : 0 }))
          .sort((left, right) => right.score - left.score)[0]?.nodeId ?? nodeIds[0];
        consumeItem();
        setTrapNodes((nodes) => [...nodes.filter((trap) => trap.nodeId !== selectedNodeId), { nodeId: selectedNodeId, ownerId: itemOwnerId }]);
        addLog(`${getSeatDisplayName(itemOwnerSeat)}님이 ${trapPiece.label} 주변 ${selectedNodeId} 칸에 함정을 설치했습니다.`);
        return;
      }
      setItemPromptTiming(null);
      setPendingTrapPlacement({ ownerId: itemOwnerId, pieceId: trapPiece.id, nodeIds, deadline: Date.now() + 10000 });
      addLog(`${trapPiece.label} 기준 1칸 이내에서 함정을 설치할 칸을 선택하세요.`);
    }
  }


  async function toggleMyReady() {
    if (isRoomManager) return;
    const mySeat = seats.find((seat) => seat.id === localSeatId && !seat.isEmpty && !seat.isAI);
    if (!mySeat) { setMessage('내 참가 정보를 찾는 중입니다. 잠시 뒤 다시 시도하세요.'); return; }
    const nextReady = !mySeat.ready;
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === mySeat.id ? { ...seat, ready: nextReady } : seat));
    try {
      if (activeRoomId) await updateRoomPlayer(activeRoomId, mySeat.id, { ready: nextReady });
      setMessage(nextReady ? '준비 완료했습니다. 방장이 시작할 때까지 기다려주세요.' : '준비를 취소했습니다.');
    } catch (error) {
      setSeats((currentSeats) => currentSeats.map((seat) => seat.id === mySeat.id ? { ...seat, ready: mySeat.ready } : seat));
      setMessage(error instanceof Error ? error.message : '준비 상태 변경에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
    }
  }

  async function leaveRoom() {
    const leavingRoomId = activeRoomId;
    const leavingSeatId = localSeatId;
    const wasGameScreen = screen === 'game';
    leavingRoomRef.current = true;
    const leavingSeat = seats.find((seat) => seat.id === leavingSeatId && !seat.isEmpty && !seat.isAI);
    const aiName = leavingSeat ? makeUniqueAIName(seats) : '';
    if (wasGameScreen && leavingRoomId) addLog(`${nickname}님이 나갔습니다. AI가 이어서 플레이합니다.`);
    hostingRoomUserIdRef.current = '';
    activeRoomIdRef.current = '';
    confirmedRoomPlayerRef.current = false;
    setScreen('lobby'); setActiveRoomId(''); setActiveRoomTitle(''); setActiveRoomHostId(''); setIsRoomHost(false); setCountdown(-1); setTurnOrderIds([]); setGameStartedAt(null); setSeats(createSeats(nickname, playMode, maxPlayers));
    window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
    window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    setMessage('방에서 나왔습니다.');
    if (!leavingRoomId || !leavingSeatId) {
      leavingRoomRef.current = false;
      return;
    }
    try {
      if (wasGameScreen && leavingSeat) {
        pendingAiSeatIdsRef.current.add(leavingSeatId);
        await updateRoomPlayer(leavingRoomId, leavingSeatId, getAiRoomPlayerUpdate(leavingSeat, aiName));
        pendingAiSeatIdsRef.current.delete(leavingSeatId);
      } else {
        await removeRoomPlayer(leavingRoomId, leavingSeatId);
      }
    } catch (error) {
      pendingAiSeatIdsRef.current.delete(leavingSeatId);
      console.warn('방 나가기 정리에 실패했습니다.', error);
    } finally {
      leavingRoomRef.current = false;
    }
  }

  function returnToWaitingRoom() {
    const finishedRoomId = activeRoomId;
    setScreen(finishedRoomId ? 'waitingRoom' : 'lobby');
    setCountdown(-1);
    setItemPromptTiming(null);
    setEndGameDialogOpen(false);
    setMessage(finishedRoomId ? '방 대기실로 돌아왔습니다.' : '첫 대기화면으로 돌아왔습니다.');
    if (finishedRoomId) {
      void updateRoomStatus(finishedRoomId, 'waiting').catch((error) => {
        console.warn('완주 후 방 대기실 전환에 실패했습니다.', error);
      });
    }
  }

  function finishGame() {
    const finishedRoomId = activeRoomId;
    const finishedSeatId = localSeatId;
    const shouldSubstituteAsAi = Boolean(finishedRoomId && finishedSeatId && screen === 'game' && !winner);
    const shouldLeaveFinishedRoom = Boolean(finishedRoomId && finishedSeatId && screen === 'game' && winner);
    const leavingSeat = shouldSubstituteAsAi ? seats.find((seat) => seat.id === finishedSeatId && !seat.isEmpty && !seat.isAI) : undefined;
    const aiName = leavingSeat ? makeUniqueAIName(seats) : '';
    if (shouldLeaveFinishedRoom) leavingRoomRef.current = true;
    hostingRoomUserIdRef.current = '';
    activeRoomIdRef.current = '';
    confirmedRoomPlayerRef.current = false;
    setScreen('lobby');
    setActiveRoomTitle('');
    setActiveRoomId('');
    setActiveRoomHostId('');
    setIsRoomHost(false);
    window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
    window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    setSeats(createSeats(nickname, playMode, maxPlayers));
    setCountdown(-1);
    setTurnOrderIds([]);
    setGameStartedAt(null);
    setItemPromptTiming(null);
    setEndGameDialogOpen(false);
    setMessage('게임을 나와 로비로 이동했습니다.');
    if (finishedRoomId && finishedSeatId && shouldSubstituteAsAi && leavingSeat) {
      pendingAiSeatIdsRef.current.add(finishedSeatId);
      void updateRoomPlayer(finishedRoomId, finishedSeatId, getAiRoomPlayerUpdate(leavingSeat, aiName))
        .catch((error) => console.warn('게임 종료 후 AI 전환에 실패했습니다.', error))
        .finally(() => pendingAiSeatIdsRef.current.delete(finishedSeatId));
    }
    if (finishedRoomId && finishedSeatId && shouldLeaveFinishedRoom) {
      void removeRoomPlayer(finishedRoomId, finishedSeatId, { preservePlayingSeatAsAi: false })
        .catch((error) => console.warn('완주 후 방 나가기 정리에 실패했습니다.', error))
        .finally(() => { leavingRoomRef.current = false; });
    }
  }

  function continueRace() {
    if (!activeRoomId) {
      setMessage('온라인 방 정보가 없어 이어서 진행할 수 없습니다.');
      return;
    }
    if (!canShowContinueRaceButton) {
      setMessage('이어서 진행할 수 있는 플레이어가 부족합니다.');
      return;
    }
    const actionKey = `continue_race:${activeRoomId}:${continuationRound + 1}:${Date.now()}`;
    addPendingLocalRemoteAction(actionKey);
    void commitAuthoritativeGameAction(activeRoomId, { type: 'continue_race', actorId: localSeatId, payload: { clientActionId: actionKey } })
      .then((result) => {
        if (result.status === 'rejected' || result.status === 'unsupported') {
          setMessage(result.reason ?? '이어서 진행 요청을 처리하지 못했습니다.');
          return;
        }
        setScreen('game');
        setMessage('완주하지 못한 플레이어가 이어서 진행합니다.');
        void updateRoomStatus(activeRoomId, 'playing').catch((error) => {
          console.warn('이어서 진행 후 게임중 상태 반영에 실패했습니다.', error);
        });
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '이어서 진행 요청을 처리하지 못했습니다.'))
      .finally(() => deletePendingLocalRemoteAction(actionKey));
  }

  async function changeWaitingOptions(next: { itemMode?: boolean; stackedRollMode?: boolean; pieceCount?: PieceCount; playMode?: PlayMode; maxPlayers?: 2 | 3 | 4 }) {
    const nextPlayMode = next.playMode ?? playMode;
    const nextMaxPlayers = nextPlayMode === 'team' ? 4 : next.maxPlayers ?? maxPlayers;
    const nextItemMode = next.itemMode ?? itemMode;
    const nextStackedRollMode = next.stackedRollMode ?? stackedRollMode;
    const nextPieceCount = next.pieceCount ?? (next.playMode === 'team' && playMode !== 'team' ? 2 : pieceCount);
    const activePlayerCount = seats.filter((seat) => !seat.isEmpty && !seat.isSpectator).length;
    if (nextMaxPlayers < activePlayerCount) {
      setMessage(`현재 참가 인원 ${activePlayerCount}명보다 적게 인원을 줄일 수 없습니다.`);
      return;
    }
    setPlayMode(nextPlayMode);
    setMaxPlayers(nextMaxPlayers);
    setItemMode(nextItemMode);
    setStackedRollMode(nextStackedRollMode);
    setPieceCount(nextPieceCount);
    if (canManageRoom && activeRoomId) await updateRoomOptions(activeRoomId, { playMode: nextPlayMode, maxPlayers: nextMaxPlayers, itemMode: nextItemMode, stackedRollMode: nextStackedRollMode, pieceCount: nextPieceCount });
  }

  function openNicknameDialog() {
    if (screen !== 'lobby') return;
    setNicknameDraft(nickname);
    setNicknameDialogOpen(true);
  }

  function saveNickname() {
    const nextNickname = normalizeNickname(nicknameDraft);
    if (!nextNickname) { setMessage('닉네임은 비워둘 수 없습니다.'); return; }
    setNickname(nextNickname);
    setNicknameDialogOpen(false);
    setMessage('닉네임이 변경되었습니다.');
  }

  function toggleSoundEnabled() {
    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);
    if (nextEnabled) playSoundEffect('toast', true);
  }


  return <main data-testid="app-shell" className={`shell ${screen === 'game' ? 'game-shell' : 'lobby-shell'}`}>
    <AppShellHeader
      activeRoomId={activeRoomId}
      manualSequenceSyncing={manualSequenceSyncing}
      nickname={nickname}
      playTimeText={playTimeText}
      screen={screen}
      serverStatus={serverStatus}
      serverStatusTone={serverStatusTone}
      soundEnabled={soundEnabled}
      winner={winner}
      onOpenNicknameDialog={openNicknameDialog}
      onSyncLatestSequences={syncLatestSequencesFromBadge}
      onToggleSoundEnabled={toggleSoundEnabled}
    />

    <AppModals
      actionErrorDialog={actionErrorDialog}
      diagnosticCopied={diagnosticCopied}
      diagnosticDialogOpen={diagnosticDialogOpen}
      diagnosticText={diagnosticText}
      endGameDialogOpen={endGameDialogOpen}
      gameExitDescription={gameExitDescription}
      itemPickupClock={itemPickupClock}
      loadingMessage={loadingMessage}
      nicknameDialogOpen={nicknameDialogOpen}
      nicknameDraft={nicknameDraft}
      pendingItemPickup={pendingItemPickup}
      roomNoticeDialog={roomNoticeDialog}
      screen={screen}
      onClearActionErrorDialog={() => setActionErrorDialog('')}
      onCloseDiagnosticDialog={() => setDiagnosticDialogOpen(false)}
      onCloseEndGameDialog={() => setEndGameDialogOpen(false)}
      onCloseNicknameDialog={() => setNicknameDialogOpen(false)}
      onClearRoomNoticeDialog={() => setRoomNoticeDialog(null)}
      onCopyDiagnosticState={copyDiagnosticState}
      onFinishGame={finishGame}
      onKeepPendingItemPickup={() => keepPendingItemPickup()}
      onNicknameDraftChange={setNicknameDraft}
      onReplacePendingItemPickup={() => replacePendingItemPickup()}
      onSaveNickname={saveNickname}
    />

    {screen === 'lobby' && <LobbyContainer
      title={title}
      rooms={rooms}
      isCreatingRoom={isCreatingRoom}
      isFirebaseConfigured={isFirebaseConfigured}
      currentUser={currentUser}
      resumableRoomId={window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? ''}
      onTitleChange={setTitle}
      onCreateRoom={handleCreateRoom}
      onOpenWaitingRoom={openWaitingRoom}
    />}

    {screen === 'waitingRoom' && <WaitingRoomContainer
      canManageRoom={canManageRoom}
      activeRoomTitle={activeRoomTitle}
      title={title}
      seats={seats}
      localSeatId={localSeatId}
      playMode={playMode}
      maxPlayers={maxPlayers}
      pieceCount={pieceCount}
      itemMode={itemMode}
      stackedRollMode={stackedRollMode}
      teamBalanced={teamBalanced}
      teamCounts={teamCounts}
      allReady={allReady}
      countdown={countdown}
      startStatus={startStatus}
      roomInGame={roomInGame}
      startCountdownStartsAt={startCountdownStartsAt}
      startCancelDisabled={startCancelDisabled}
      getSeatPieceColor={getSeatPieceColor}
      onChangeOptions={changeWaitingOptions}
      onKickPlayer={(seat) => { void kickWaitingPlayer(seat); }}
      onAddAI={markPlayerAsAI}
      onRemoveAI={cancelAISeat}
      onChangeTeam={changeTeam}
      onCancelStartCountdown={cancelStartCountdown}
      onStartGame={handleStartGame}
      onToggleReady={() => { void toggleMyReady(); }}
      onLeaveRoom={leaveRoom}
    />}
    {screen === 'game' && <GameScreenView
      activeItemPromptTypes={activeItemPromptTypes}
      activeMovablePiece={activeMovablePiece}
      activeRoomTitle={activeRoomTitle}
      activeSeat={activeSeat}
      activeSeatTurnText={activeSeat ? getSeatDisplayName(activeSeat) : ''}
      activeTurnOrderIntro={activeTurnOrderIntro}
      boardItems={boardItems}
      boardTurnIndicatorColor={boardTurnIndicatorColor}
      boardTurnIndicatorText={boardTurnIndicatorText}
      boardTurnIndicatorRollStack={boardTurnIndicatorRollStack}
      branchChoice={branchChoice}
      canContinueRace={canShowContinueRaceButton}
      canRequestMove={canRequestMove}
      canRollNow={canRollNow}
      canSeatControlPiece={canSeatControlPiece}
      canSubmitTurnAction={canSubmitTurnAction}
      captureEffect={captureEffect}
      fallEffect={fallEffect}
      displayBranchChoice={displayBranchChoice}
      finalHoldMs={TURN_ORDER_FINAL_HOLD_MS}
      formatStoredLogSequence={formatStoredLogSequence}
      getItemPromptTimeoutMs={getItemPromptTimeoutMs}
      getLogCardStyle={getLogCardStyle}
      getPieceSideKey={getPieceSideKey}
      getPlayerCardName={getPlayerCardName}
      getSeatPieceColor={getSeatPieceColor}
      getTurnActionTimeoutMs={getTurnActionTimeoutMs}
      goldenYutChoices={GOLDEN_YUT_CHOICES}
      goldenYutPickerOpen={goldenYutPickerOpen}
      hasActiveTurnOrderIntro={Boolean(activeTurnOrderIntro)}
      highlightedNodeId={highlightedNodeId}
      isMyTurn={isMyTurn}
      localSeatId={localSeatId}
      logs={visibleLogs}
      movingPieceId={movingPieceId}
      ownedItems={ownedItems}
      pendingTrapPlacement={Boolean(pendingTrapPlacement)}
      pieces={pieces}
      playMode={playMode}
      maxPlayers={maxPlayers}
      pieceCount={pieceCount}
      itemMode={itemMode}
      stackedRollMode={stackedRollMode}
      rollStack={rollStack}
      selectedRollStackIndex={selectedRollStackIndex}
      rollStackClosed={rollStackClosed}
      onSelectRollStackIndex={setSelectedRollStackIndex}
      playerPanelSeats={playerPanelSeats}
      completedSeatIds={completedSeatIds}
      rankingSeatIds={rankingSeatIds}
      previewNodeIds={previewNodeIds}
      previousBoardTurnText={previousBoardTurnText}
      previousBoardTurnColor={previousBoardTurnColor}
      nextBoardTurnText={nextBoardTurnText}
      nextBoardTurnColor={nextBoardTurnColor}
      revealedItems={revealedItems}
      roll={roll}
      rollAnimation={rollAnimation}
      rollResultHolding={rollResultHolding}
      selectedGroupPieceIds={selectedGroupPieceIds}
      selectedPieceId={selectedPieceId}
      seats={playableSeats}
      showBottomBranchControls={showBottomBranchControls}
      showBoardTurnNeighbors={shouldShowBoardTurnNeighbors}
      spectators={spectators}
      title={title}
      toast={toast}
      trapEffect={trapEffect}
      trapNodes={trapNodes}
      trapPlacementNodeIds={trapPlacementNodeIds}
      trapPlacementSecondsLeft={Math.max(0, Math.ceil(((pendingTrapPlacement?.deadline ?? 0) - trapPlacementClock) / 1000))}
      turnActionTimeoutMs={TURN_ACTION_TIMEOUT_MS}
      turnOrderClock={turnOrderClock}
      turnOrderPhase={turnOrderPhase}
      turnToast={turnToast}
      waitingForOnlineTurnOrder={waitingForOnlineTurnOrder}
      winner={winner}
      winnerText={renderWinnerText()}
      onBranchChoiceChange={setBranchChoice}
      onContinueRace={continueRace}
      onReturnToWaitingRoom={returnToWaitingRoom}
      onFinishGame={finishGame}
      onGoldenYutSelect={(choice) => { setForcedRoll(choice); setGoldenYutPickerOpen(false); showToast('황금 윷 설정 완료', `${choice.name} 결과가 예약되었습니다.`, '✨'); }}
      onMoveSelectedPiece={() => moveSelectedPiece()}
      onOpenEndGameDialog={() => setEndGameDialogOpen(true)}
      onOpenDiagnosticDialog={() => setDiagnosticDialogOpen(true)}
      onRollYut={rollYut}
      onSelectPieceId={setSelectedPieceId}
      onSelectTrapNode={placePendingTrap}
      onSkipItemPrompt={() => { clearTurnActionTimeoutPenalty(localSeatId); setItemPromptTiming(null); }}
      onUseItem={useItem}
      renderLogText={renderLogText}
    />}
  </main>;
}
