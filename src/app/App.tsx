import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { GameBoard, type BoardPiece } from '../features/game/components/GameBoard';
import { ItemCard } from '../features/items/components/ItemCard';
import type { ItemTiming, ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { BOARD_NODES, BRANCH_NODE_IDS, getBoardNodeById, getMovePathNodeIds, getNearbyNodeIds, spawnInitialBoardItems, type BoardItem, type BranchChoice } from '../game-core/board/board';
import { GOLDEN_YUT_CHOICES, makeDisplaySticks, rollYutResult, type YutResult, type YutStick } from '../game-core/roll';
import { cleanupStaleRooms, commitAuthoritativeGameAction, createRoom, deleteRoom, findActiveRoomByHost, getRoom, heartbeatRoomPlayer, joinRoom, leaveDuplicatePlayerRooms, markGameActionProcessed, removeRoomPlayer, saveGameState, scheduleEmptyRoomDeletion, subscribeGameState, subscribePendingGameActions, subscribeRoom, subscribeRoomPlayers, submitGameAction, updateRoomOptions, updateRoomPlayer, updateRoomStatus, type GameAction, type GameSequenceType, type RoomPlayer, type RoomSummary } from '../features/room/services/roomService';
import { useRooms } from '../features/room/hooks/useRooms';
import { isFirebaseConfigured } from '../services/firebase/firebaseApp';
import { listenAuthState, signInAsGuest } from '../services/firebase/firebaseAuth';
import { playSoundEffect, type SoundEffect } from '../shared/audio/sound';
import '../styles/globals.css';

type Screen = 'lobby' | 'waitingRoom' | 'game';
type PlayMode = 'individual' | 'team';
type Team = '청팀' | '홍팀';
type PieceCount = 1 | 2 | 3 | 4;

type Seat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost?: boolean;
  isAI?: boolean;
  isEmpty?: boolean;
  isSpectator?: boolean;
  team: Team;
};

type GameLog = { id: number; text: string };
type ToastMessage = { id: number; title: string; description?: string; icon?: string };
type RollAnimation = { id: number; result: YutResult; sticks: YutStick[]; turnOrder?: boolean };
type TurnOrderRoll = { seat: Seat; result: YutResult; rollOffRound: number };
type TurnOrderPhase = { active: boolean; index: number; rolls: TurnOrderRoll[]; deadline: number; readyAt: number };
type TurnOrderIntro = { order: { seatId: string; label: string; name: string; color: string }[]; visible: boolean; readyAt: number };
type CaptureEffect = { id: number; pieceIds: string[] };
type TrapEffect = { id: number; nodeId: string; pieceIds: string[] };
type PendingTrapPlacement = { ownerId: string; pieceId: string; nodeIds: string[]; deadline: number };
type TrapNode = { nodeId: string; ownerId: string };

const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
const PLAYER_COLOR_LABELS = ['빨강', '파랑', '초록', '노랑'];
const TEAM_COLORS: Record<Team, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
const ROOM_COLOR_LABELS: Record<string, string> = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };
const STORAGE_KEYS = { nickname: 'yut-online:nickname', title: 'yut-online:title', playMode: 'yut-online:playMode', maxPlayers: 'yut-online:maxPlayers', itemMode: 'yut-online:itemMode', pieceCount: 'yut-online:pieceCount', soundEnabled: 'yut-online:soundEnabled', activeRoomId: 'yut-online:activeRoomId', isRoomHost: 'yut-online:isRoomHost' } as const;
const getStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === 'true';
};
const getStoredNumber = <T extends number>(key: string, fallback: T, allowed: readonly T[]) => {
  if (typeof window === 'undefined') return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return allowed.includes(stored as T) ? stored as T : fallback;
};
const getStoredPlayMode = () => {
  const stored = getStoredText(STORAGE_KEYS.playMode, 'individual');
  return stored === 'team' ? 'team' : 'individual';
};
const getStoredText = (key: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) || fallback;
};
const TURN_DELAY_MS = 650;
const TURN_ORDER_START_DELAY_MS = 3000;
const TURN_ORDER_TIMEOUT_MS = 10000;
const TURN_ORDER_TIMEOUT_FALLBACK_GRACE_MS = 1500;
const TURN_ORDER_REVEAL_MS = 5000;
const TURN_ORDER_AI_MIN_DELAY_MS = 2000;
const TURN_ORDER_AI_DELAY_SPREAD_MS = 1000;
const TURN_ORDER_ROLL_ANIMATION_MS = 2600;
const ROLL_RESULT_HOLD_MS = 2600;
const ROLL_ANIMATION_MS = 2600;
const MAX_OWNED_ITEMS = 1;
const ITEM_PICKUP_ROLL_LOCK_MS = 3000;
const TRAP_EFFECT_MS = 3000;
const AI_MOVE_DELAY_MS = 1000;
const AUTO_SINGLE_MOVE_DELAY_MS = 1000;
const CREATE_ROOM_TIMEOUT_MS = 12000;
const STEP_DELAY_MS = 240;
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const hasFinalConsonant = (text: string) => {
  const lastCode = text.charCodeAt(text.length - 1);
  return lastCode >= 0xac00 && lastCode <= 0xd7a3 && (lastCode - 0xac00) % 28 > 0;
};
const withSubjectParticle = (text: string) => `${text}${hasFinalConsonant(text) ? '이' : '가'}`;
const withAndParticle = (text: string) => `${text}${hasFinalConsonant(text) ? '과' : '와'}`;

const AI_NAME_PREFIXES = ['씩씩한', '재빠른', '느긋한', '영리한', '용감한', '유쾌한', '차분한', '반짝이는', '든든한', '행운의'];
const AI_NAME_BASES = ['단풍이', '구름이', '호랑이', '두루미', '반달이', '별님이', '솔방울', '바람이', '나무꾼', '달토끼', '해님이', '복주머니'];
const RANDOM_NICKNAME_PREFIXES = ['민첩한', '행운의', '반짝이는', '용감한', '느긋한', '쾌활한', '든든한', '재빠른'];
const RANDOM_NICKNAME_BASES = ['토끼', '호랑이', '두루미', '다람쥐', '구름', '단풍', '별님', '솔방울'];
const makeRandomNickname = () => `${RANDOM_NICKNAME_PREFIXES[Math.floor(Math.random() * RANDOM_NICKNAME_PREFIXES.length)]} ${RANDOM_NICKNAME_BASES[Math.floor(Math.random() * RANDOM_NICKNAME_BASES.length)]}${Math.floor(Math.random() * 90) + 10}`;
const getInitialNickname = () => getStoredText(STORAGE_KEYS.nickname, '') || makeRandomNickname();

const createSeats = (hostName: string, playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
  const defaultTeams: Team[] = playMode === 'team' ? ['청팀', '홍팀', '청팀', '홍팀'] : ['청팀', '청팀', '청팀', '청팀'];

  return Array.from({ length: playerCount }, (_, index) => ({
    id: index === 0 ? 'host' : `slot-${index + 1}`,
    label: `P${index + 1}`,
    name: index === 0 ? hostName || '플레이어' : '빈 자리',
    color: PLAYER_COLOR_LABELS[index] ?? '검정',
    ready: index === 0,
    isHost: index === 0,
    isEmpty: index !== 0,
    team: defaultTeams[index] ?? '청팀',
  }));
};


const seatsFromRoomPlayers = (players: RoomPlayer[], playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
  const defaults = createSeats('', playMode, playerCount);
  const activePlayers = players.filter((player) => !player.isSpectator);
  return defaults.map((seat, index) => {
    const player = activePlayers.find((candidate) => candidate.seatIndex === index);
    if (!player) return seat;
    return {
      ...seat,
      id: player.id,
      name: player.nickname,
      color: ROOM_COLOR_LABELS[player.color] ?? player.color,
      ready: player.ready,
      isHost: index === 0,
      isAI: player.isAI,
      isEmpty: false,
      team: player.team,
    };
  });
};


const seatsWithJoinedPlayer = (players: RoomPlayer[], currentUserId: string, nickname: string, playMode: PlayMode, playerCount: 2 | 3 | 4, joinedSeatIndex: number | null = null): Seat[] => {
  const seats = seatsFromRoomPlayers(players, playMode, playerCount);
  if (players.some((player) => player.id === currentUserId)) return seats;
  const targetSeat = joinedSeatIndex === null ? seats.find((seat) => seat.isEmpty) : seats[joinedSeatIndex];
  if (!targetSeat) return seats;
  return seats.map((seat) => seat.id === targetSeat.id ? { ...seat, id: currentUserId, name: nickname, ready: false, isEmpty: false } : seat);
};

const spectatorsFromRoomPlayers = (players: RoomPlayer[]): Seat[] => players
  .filter((player) => player.isSpectator)
  .map((player) => ({ id: player.id, label: '관전', name: player.nickname, color: '관전', ready: true, isSpectator: true, team: '청팀' as Team }));

const makePieces = (seats: Seat[], pieceCount: PieceCount, mode: PlayMode = 'individual'): BoardPiece[] => {
  const activeSeats = seats.filter((seat) => !seat.isEmpty);
  if (mode === 'team') {
    return (['청팀', '홍팀'] as Team[]).flatMap((team) => {
      const teamSeats = activeSeats.filter((seat) => seat.team === team);
      return Array.from({ length: pieceCount }, (_, pieceIndex) => {
        const ownerSeat = teamSeats[pieceIndex % Math.max(teamSeats.length, 1)] ?? teamSeats[0];
        return {
          id: `${team}-piece-${pieceIndex + 1}`,
          ownerId: ownerSeat?.id ?? team,
          label: `${team === '청팀' ? '청' : '홍'}-${pieceIndex + 1}`,
          color: TEAM_COLORS[team],
          nodeIndex: 0,
          nodeId: 'n01',
          started: false,
          finished: false,
        };
      });
    });
  }

  return activeSeats.flatMap((seat, index) =>
    Array.from({ length: pieceCount }, (_, pieceIndex) => ({
      id: `${seat.id}-piece-${pieceIndex + 1}`,
      ownerId: seat.id,
      label: `${seat.label}-${pieceIndex + 1}`,
      color: PLAYER_COLORS[Number(seat.label.replace('P', '')) - 1] ?? '#2a1e17',
      nodeIndex: 0,
      nodeId: 'n01',
      started: false,
      finished: false,
    })),
  );
};

const getEffectiveBranchChoice = (nodeId: string, branchChoice: BranchChoice) => BRANCH_NODE_IDS.includes(nodeId as typeof BRANCH_NODE_IDS[number]) ? branchChoice : 'outer';

const getMovePreviewNodeIds = (piece: BoardPiece | undefined, result: YutResult | null, branchChoice: BranchChoice) => {
  if (!piece || !result || piece.finished) return [];
  if (result.steps < 0 && !piece.started) return [];
  return getMovePathNodeIds(piece.nodeId, result.steps, getEffectiveBranchChoice(piece.nodeId, branchChoice));
};

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
  const [title, setTitle] = useState(() => getStoredText(STORAGE_KEYS.title, '친구들과 윷놀이'));
  const [playMode, setPlayMode] = useState<PlayMode>(() => getStoredPlayMode());
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(() => getStoredNumber(STORAGE_KEYS.maxPlayers, 4, [2, 3, 4] as const));
  const [itemMode, setItemMode] = useState(() => getStoredBoolean(STORAGE_KEYS.itemMode, true));
  const [pieceCount, setPieceCount] = useState<PieceCount>(() => getStoredNumber(STORAGE_KEYS.pieceCount, 4, [1, 2, 3, 4] as const));
  const [soundEnabled, setSoundEnabled] = useState(() => getStoredBoolean(STORAGE_KEYS.soundEnabled, true));
  const [message, setMessage] = useState('');
  const [screen, setScreen] = useState<Screen>('lobby');
  const [activeRoomTitle, setActiveRoomTitle] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [countdown, setCountdown] = useState(-1);
  const [spectators, setSpectators] = useState<Seat[]>([]);
  const [pendingItemPickup, setPendingItemPickup] = useState<{ seatId: string; item: ItemType; itemId: string } | null>(null);
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
  const [turnOrderIds, setTurnOrderIds] = useState<string[]>([]);
  const [roll, setRoll] = useState<YutResult | null>(null);
  const [movingPieceId, setMovingPieceId] = useState('');
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [turnToast, setTurnToast] = useState<{ id: number; text: string } | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState('');
  const [branchChoice, setBranchChoice] = useState<BranchChoice>('outer');
  const [turnOrderPhase, setTurnOrderPhase] = useState<TurnOrderPhase>({ active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 });
  const [turnOrderIntro, setTurnOrderIntro] = useState<TurnOrderIntro | null>(null);
  const [turnOrderClock, setTurnOrderClock] = useState(() => Date.now());
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const [captureEffect, setCaptureEffect] = useState<CaptureEffect | null>(null);
  const [trapEffect, setTrapEffect] = useState<TrapEffect | null>(null);
  const [pendingTrapPlacement, setPendingTrapPlacement] = useState<PendingTrapPlacement | null>(null);
  const [forcedRoll, setForcedRoll] = useState<YutResult | null>(null);
  const [goldenYutPickerOpen, setGoldenYutPickerOpen] = useState(false);
  const [itemPromptTiming, setItemPromptTiming] = useState<ItemTiming | null>(null);
  const [rollLockUntil, setRollLockUntil] = useState(0);
  const [rollLockClock, setRollLockClock] = useState(() => Date.now());
  const [rollResultReadyAt, setRollResultReadyAt] = useState(0);
  const [trapPlacementClock, setTrapPlacementClock] = useState(() => Date.now());
  const [rollInProgress, setRollInProgress] = useState(false);
  const processingActionIdsRef = useRef<Set<string>>(new Set());
  const completedActionIdsRef = useRef<Set<string>>(new Set());
  const processedClientActionIdsRef = useRef<Set<string>>(new Set());
  const rollInProgressRef = useRef(false);
  const moveInProgressRef = useRef(false);
  const pendingLocalRemoteActionsRef = useRef<Set<string>>(new Set());
  const remoteActionRetryTimersRef = useRef<Map<string, number>>(new Map());
  const currentRollRef = useRef<YutResult | null>(null);
  const rollAnimationTimerRef = useRef<number | null>(null);
  const lastAnimatedRollKeyRef = useRef('');
  const pendingSequenceMetaRef = useRef<{ type: GameSequenceType; actorId: string; payload?: Record<string, unknown>; clientMutationId?: string } | null>(null);
  const applyingSyncedStateRef = useRef(false);
  const lastAppliedStateVersionRef = useRef(0);
  const lastWinnerSoundRef = useRef('');
  const lastBranchControlKeyRef = useRef('');
  const lastSavedStateFingerprintRef = useRef('');
  const savingStateFingerprintRef = useRef('');
  const aiTurnActionKeyRef = useRef('');
  const liveTurnGuardRef = useRef({ activeSeatId: '', winner: '', movingPieceId: '', pendingTrapPlacement: false, turnOrderActive: false, turnOrderIntro: false });
  const activeRoomIdRef = useRef('');
  const logIdRef = useRef(0);
  const spectatorIdsRef = useRef<Set<string>>(new Set());
  const pendingAiSeatIdsRef = useRef<Set<string>>(new Set());
  const rooms = useRooms();
  const currentUser = userRef.current ?? user;
  const currentUserId = currentUser?.uid ?? '';
  const serverStatus = isFirebaseConfigured ? (currentUser ? '온라인' : '입장 준비 중') : '연결 정보 확인 필요';
  const serverStatusTone = isFirebaseConfigured ? (currentUser ? 'online' : 'pending') : 'offline';
  const playableSeats = useMemo(() => seats.filter((seat) => !seat.isEmpty), [seats]);
  const teamCounts = useMemo(() => playableSeats.reduce<Record<Team, number>>((acc, seat) => ({ ...acc, [seat.team]: acc[seat.team] + 1 }), { 청팀: 0, 홍팀: 0 }), [playableSeats]);
  const teamBalanced = playMode === 'individual' || (maxPlayers === 4 && teamCounts.청팀 === 2 && teamCounts.홍팀 === 2);
  const allReady = seats.every((seat) => !seat.isEmpty && (seat.ready || seat.isAI)) && teamBalanced;
  const turnSeats = useMemo(() => {
    if (!turnOrderIds.length) return playableSeats;
    const orderedSeats = turnOrderIds.map((seatId) => playableSeats.find((seat) => seat.id === seatId)).filter((seat): seat is Seat => Boolean(seat));
    return orderedSeats.length === playableSeats.length ? orderedSeats : playableSeats;
  }, [playableSeats, turnOrderIds]);
  const activeSeat = turnSeats[turnIndex % turnSeats.length];
  const hostSeatId = playableSeats.find((seat) => seat.isHost)?.id ?? 'host';
  const localSeatId = activeRoomId ? currentUserId : hostSeatId;
  const canManageRoom = isRoomHost || Boolean(activeRoomId && currentUserId && hostSeatId === currentUserId);
  const isSpectator = Boolean(activeRoomId && currentUserId && spectators.some((spectator) => spectator.id === currentUserId));
  const isMyTurn = activeSeat?.id === localSeatId && !activeSeat.isAI && !isSpectator;
  const getSeatById = (seatId: string) => playableSeats.find((seat) => seat.id === seatId);
  const getSeatColorIndex = (seat: Seat | undefined) => Math.max(0, Number(seat?.label.replace('P', '')) - 1);
  const getSeatPieceColor = (seat: Seat | undefined) => PLAYER_COLORS[getSeatColorIndex(seat)] ?? '#2a1e17';
  const getSeatPieceColorLabel = (seat: Seat | undefined) => PLAYER_COLOR_LABELS[getSeatColorIndex(seat)] ?? seat?.color ?? '검정';
  const isSameSide = (a: Seat | undefined, b: Seat | undefined) => Boolean(a && b && (playMode === 'team' ? a.team === b.team : a.id === b.id));
  const canSeatControlPiece = (seat: Seat | undefined, piece: BoardPiece | undefined) => Boolean(seat && piece && isSameSide(getSeatById(piece.ownerId), seat));
  const selectedPiece = useMemo(() => pieces.find((piece) => piece.id === selectedPieceId), [pieces, selectedPieceId]);
  const selectedGroupPieceIds = useMemo(() => {
    if (!selectedPiece || !selectedPiece.started || selectedPiece.finished) return selectedPiece ? [selectedPiece.id] : [];
    const selectedOwnerSeat = getSeatById(selectedPiece.ownerId);
    return pieces
      .filter((piece) => piece.started && !piece.finished && piece.nodeId === selectedPiece.nodeId && isSameSide(getSeatById(piece.ownerId), selectedOwnerSeat))
      .map((piece) => piece.id);
  }, [pieces, playMode, playableSeats, selectedPiece]);
  const trapPlacementNodeIds = pendingTrapPlacement?.nodeIds ?? [];
  const previewNodeIds = useMemo(() => isMyTurn && !movingPieceId && canSeatControlPiece(activeSeat, selectedPiece) ? getMovePreviewNodeIds(selectedPiece, roll, branchChoice) : [], [activeSeat, branchChoice, isMyTurn, movingPieceId, roll, selectedPiece]);
  const formatPlayTime = (elapsedMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const two = (value: number) => String(value).padStart(2, '0');
    return hours > 0 ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
  };
  const playTimeText = gameStartedAt ? formatPlayTime(playTimeNow - gameStartedAt) : '00:00';
  const winner = useMemo(() => {
    if (playMode === 'team') {
      const finishedTeam = (['청팀', '홍팀'] as Team[]).find((team) => playableSeats.filter((seat) => seat.team === team).every((seat) => pieces.filter((piece) => getSeatById(piece.ownerId)?.team === team).every((piece) => piece.finished)));
      return finishedTeam ? `${finishedTeam} 승리` : '';
    }
    const finishedSeat = playableSeats.find((seat) => pieces.filter((piece) => piece.ownerId === seat.id).every((piece) => piece.finished));
    return finishedSeat ? `${finishedSeat.label}-${finishedSeat.name} 승리` : '';
  }, [pieces, playMode, playableSeats]);
  const selectedMoveSteps = roll?.steps ?? 0;
  const isRollLocked = rollLockUntil > rollLockClock;
  const rollResultHolding = rollResultReadyAt > rollLockClock;
  const trapPlacementActive = Boolean(pendingTrapPlacement);
  const isRemoteActionClient = Boolean(activeRoomId && !isRoomHost);
  const canSubmitTurnAction = Boolean(activeSeat && isMyTurn && !winner && !turnOrderPhase.active && !turnOrderIntro && !movingPieceId && !trapPlacementActive);
  const canMoveSelectedPiece = Boolean(roll && activeSeat && isMyTurn && canSeatControlPiece(activeSeat, selectedPiece) && !selectedPiece?.finished && (selectedMoveSteps >= 0 || selectedPiece?.started));
  const canRequestMove = Boolean(canSubmitTurnAction && roll && !rollResultHolding && canMoveSelectedPiece);
  const canUseMoveButton = canRequestMove;
  const canRollNow = Boolean(canSubmitTurnAction && !roll && !isRollLocked && (isRemoteActionClient || !rollInProgress));
  const rolledTurnOrderSeatIds = useMemo(() => new Set(turnOrderPhase.rolls.map((rollEntry) => rollEntry.seat.id)), [turnOrderPhase.rolls]);
  const localTurnOrderSeatRolled = rolledTurnOrderSeatIds.has(localSeatId);
  const isTurnOrderTimedOut = Boolean(turnOrderPhase.active && turnOrderPhase.deadline > 0 && turnOrderClock >= turnOrderPhase.deadline && playableSeats.some((seat) => !rolledTurnOrderSeatIds.has(seat.id)));
  const isTurnOrderFallbackDue = Boolean(turnOrderPhase.active && turnOrderPhase.deadline > 0 && turnOrderClock >= turnOrderPhase.deadline + TURN_ORDER_TIMEOUT_FALLBACK_GRACE_MS);
  const canForceTurnOrderProgress = Boolean(isTurnOrderTimedOut && (!activeRoomId || isRoomHost));
  liveTurnGuardRef.current = {
    activeSeatId: activeSeat?.id ?? '',
    winner,
    movingPieceId,
    pendingTrapPlacement: Boolean(pendingTrapPlacement),
    turnOrderActive: turnOrderPhase.active,
    turnOrderIntro: Boolean(turnOrderIntro),
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
  const showBottomBranchControls = Boolean(canUseMoveButton && selectedPiece?.started && BRANCH_NODE_IDS.includes(selectedPiece.nodeId as typeof BRANCH_NODE_IDS[number]));
  const activeItemPromptTypes = itemPromptTiming && !trapPlacementActive ? getUsableHostItems(itemPromptTiming) : [];


  useEffect(() => () => {
    remoteActionRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    remoteActionRetryTimersRef.current.clear();
    if (rollAnimationTimerRef.current !== null) window.clearTimeout(rollAnimationTimerRef.current);
  }, []);

  useEffect(() => {
    currentRollRef.current = roll;
  }, [roll]);

  const clearRoll = () => {
    currentRollRef.current = null;
    setRoll(null);
  };

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
    lastAppliedStateVersionRef.current = 0;
    processingActionIdsRef.current.clear();
    completedActionIdsRef.current.clear();
    processedClientActionIdsRef.current.clear();
    rollInProgressRef.current = false;
    setRollInProgress(false);
    moveInProgressRef.current = false;
    currentRollRef.current = null;
    lastAnimatedRollKeyRef.current = '';
    pendingSequenceMetaRef.current = null;
    pendingLocalRemoteActionsRef.current.clear();
    lastSavedStateFingerprintRef.current = '';
    savingStateFingerprintRef.current = '';
    if (rollAnimationTimerRef.current !== null) {
      window.clearTimeout(rollAnimationTimerRef.current);
      rollAnimationTimerRef.current = null;
    }
    setRollAnimation(null);
    if (activeRoomId) window.localStorage.setItem(STORAGE_KEYS.activeRoomId, activeRoomId);
    else window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
  }, [activeRoomId, currentUser]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.isRoomHost, String(isRoomHost)); }, [isRoomHost]);

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
    setMessage('새로고침 전 참여 중이던 방을 확인하고 있습니다...');
    void (async () => {
      try {
        const storedRoom = await getRoom(storedRoomId);
        if (cancelled) return;
        if (!storedRoom || storedRoom.status === 'finished') {
          window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
          window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
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
        setPlayMode(storedRoom.playMode);
        setMaxPlayers(restoredMaxPlayers);
        setItemMode(storedRoom.itemMode);
        setPieceCount(storedRoom.pieceCount ?? 4);
        if (joinResult?.role === 'player') {
          setSeats(seatsWithJoinedPlayer([], currentUser.uid, nickname, storedRoom.playMode, restoredMaxPlayers, joinResult.seatIndex));
        } else if (restoredAsHost) {
          setSeats(createSeats(nickname, storedRoom.playMode, restoredMaxPlayers));
        }
        setScreen(storedRoom.status === 'playing' ? 'game' : 'waitingRoom');
        setMessage('새로고침 전 참여 중이던 방을 복구했습니다.');
      } catch (error) {
        if (cancelled) return;
        window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
        window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
        setActiveRoomId('');
        setIsRoomHost(false);
        setActiveRoomTitle('');
        setScreen('lobby');
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
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.pieceCount, String(pieceCount)); }, [pieceCount]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.soundEnabled, String(soundEnabled)); }, [soundEnabled]);

  useEffect(() => {
    if (!activeRoomId || !localSeatId) return undefined;
    void heartbeatRoomPlayer(activeRoomId, localSeatId);
    const heartbeatTimer = window.setInterval(() => { void heartbeatRoomPlayer(activeRoomId, localSeatId); }, 15000);
    return () => window.clearInterval(heartbeatTimer);
  }, [activeRoomId, localSeatId]);

  useEffect(() => {
    void cleanupStaleRooms(undefined, activeRoomId);
    const cleanupTimer = window.setInterval(() => { void cleanupStaleRooms(undefined, activeRoomId); }, 30000);
    return () => window.clearInterval(cleanupTimer);
  }, [activeRoomId]);

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
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setIsRoomHost(false);
        setCountdown(-1);
        setItemPromptTiming(null);
        setTurnOrderIntro(null);
        setMessage('방이 종료되어 대기실로 이동했습니다.');
        return;
      }
      setActiveRoomTitle(room.title);
      setPlayMode(room.playMode);
      setMaxPlayers(room.maxPlayers as 2 | 3 | 4);
      setItemMode(room.itemMode);
      setPieceCount(room.pieceCount ?? 4);
      const hostUserId = (userRef.current ?? currentUser)?.uid ?? '';
      setIsRoomHost((previousIsRoomHost) => hostUserId ? room.hostId === hostUserId : previousIsRoomHost);
      if (room.status === 'playing') setScreen('game');
      if (room.status === 'finished') {
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setIsRoomHost(false);
        setCountdown(-1);
        setItemPromptTiming(null);
        setTurnOrderIntro(null);
        setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.');
      }
    });
  }, [activeRoomId, currentUserId]);


  useEffect(() => {
    if (!activeRoomId) return undefined;
    spectatorIdsRef.current = new Set();
    return subscribeRoomPlayers(activeRoomId, (players) => {
      const nextSeats = seatsFromRoomPlayers(players, playMode, maxPlayers);
      const currentUserId = (userRef.current ?? currentUser)?.uid;
      const hasCurrentUserInSnapshot = Boolean(currentUserId && players.some((player) => player.id === currentUserId && !player.isSpectator));
      players.forEach((player) => {
        if (player.isAI) pendingAiSeatIdsRef.current.delete(player.id);
      });
      setSeats((currentSeats) => {
        const seatsWithPendingAI = nextSeats.map((nextSeat) => {
          if (!pendingAiSeatIdsRef.current.has(nextSeat.id) || !nextSeat.isEmpty) return nextSeat;
          const optimisticAISeat = currentSeats.find((seat) => seat.id === nextSeat.id && seat.isAI);
          return optimisticAISeat ? { ...nextSeat, ...optimisticAISeat, isEmpty: false, ready: true, isAI: true } : nextSeat;
        });
        if (!currentUserId || isRoomHost || screen !== 'waitingRoom' || hasCurrentUserInSnapshot) return seatsWithPendingAI;
        if (seatsWithPendingAI.some((seat) => seat.id === currentUserId && !seat.isEmpty && !seat.isAI)) return seatsWithPendingAI;
        const optimisticSeat = currentSeats.find((seat) => seat.id === currentUserId && !seat.isEmpty && !seat.isAI);
        if (!optimisticSeat) return seatsWithPendingAI;
        return seatsWithPendingAI.map((seat) => seat.label === optimisticSeat.label ? { ...seat, ...optimisticSeat, isHost: false, isEmpty: false } : seat);
      });
      const nextSpectators = spectatorsFromRoomPlayers(players);
      if (isRoomHost && screen === 'game') {
        const previousIds = spectatorIdsRef.current;
        nextSpectators.forEach((spectator) => {
          if (!previousIds.has(spectator.id)) addLog(`${spectator.name}님이 관전자로 입장했습니다.`);
        });
      }
      spectatorIdsRef.current = new Set(nextSpectators.map((spectator) => spectator.id));
      setSpectators(nextSpectators);
      if (!players.length) void scheduleEmptyRoomDeletion(activeRoomId);
    });
  }, [activeRoomId, currentUserId, isRoomHost, maxPlayers, playMode, screen]);

  function playRollAnimationOnce(result: YutResult, sticks: YutStick[], key: string, turnOrder = false) {
    if (lastAnimatedRollKeyRef.current === key) return;
    lastAnimatedRollKeyRef.current = key;
    if (rollAnimationTimerRef.current !== null) window.clearTimeout(rollAnimationTimerRef.current);
    setRollAnimation({ id: Date.now(), result, sticks, turnOrder });
    rollAnimationTimerRef.current = window.setTimeout(() => {
      setRollAnimation(null);
      rollAnimationTimerRef.current = null;
    }, turnOrder ? TURN_ORDER_ROLL_ANIMATION_MS : ROLL_ANIMATION_MS);
  }

  useEffect(() => {
    if (!activeRoomId) return undefined;
    return subscribeGameState(activeRoomId, (state) => {
      if (!state) return;
      const stateVersion = Number(state.turnVersion ?? 0);
      if (stateVersion && stateVersion <= lastAppliedStateVersionRef.current) return;
      applyingSyncedStateRef.current = true;
      lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, stateVersion);
      const nextRoll = state.roll as YutResult | null;
      const nextRollResultReadyAt = Number(state.rollResultReadyAt ?? 0);
      const nextTurnIndex = Number(state.turnIndex ?? 0);
      if (nextRoll && !currentRollRef.current) {
        const animationKey = `${nextTurnIndex}:${nextRoll.name}:${nextRoll.steps}:${nextRollResultReadyAt}`;
        playRollAnimationOnce(nextRoll, makeDisplaySticks(nextRoll), animationKey);
      }
      currentRollRef.current = nextRoll;
      setPieces(state.pieces as BoardPiece[]);
      setTurnIndex(nextTurnIndex);
      setRoll(nextRoll);
      setBoardItems(state.boardItems);
      setOwnedItems(state.ownedItems as Record<string, ItemType[]>);
      setTrapNodes(state.trapNodes as TrapNode[]);
      setPendingTrapPlacement((state.pendingTrapPlacement as PendingTrapPlacement | null | undefined) ?? null);
      setShieldedPieceIds(state.shieldedPieceIds);
      setLogs(state.logs as GameLog[]);
      setCaptureEffect((state.captureEffect as CaptureEffect | null | undefined) ?? null);
      setTrapEffect((state.trapEffect as TrapEffect | null | undefined) ?? null);
      setGameStartedAt((state.gameStartedAt as number | null | undefined) ?? null);
      setTurnOrderIds((state.turnOrderIds as string[] | undefined) ?? []);
      setTurnOrderIntro((state.turnOrderIntro as TurnOrderIntro | null | undefined) ?? null);
      setRollLockUntil(Number(state.rollLockUntil ?? 0));
      setLastMovedPieceIds((state.lastMovedPieceIds as string[] | undefined) ?? []);
      setLastMovedSeatId(state.lastMovedSeatId ?? '');
      setItemPromptTiming((state.itemPromptTiming as ItemTiming | null | undefined) ?? null);
      setBranchChoice((state.branchChoice as BranchChoice | undefined) ?? 'outer');
      setRollResultReadyAt(nextRollResultReadyAt);
      setTurnOrderPhase((state.turnOrderPhase as TurnOrderPhase | null | undefined) ?? { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 });
      pendingLocalRemoteActionsRef.current.clear();
      window.setTimeout(() => { applyingSyncedStateRef.current = false; }, 0);
    });
  }, [activeRoomId, isRoomHost, screen]);

  useEffect(() => {
    if (!activeRoomId || screen !== 'game' || applyingSyncedStateRef.current) return;
    if (!isRoomHost) return;
    if (moveInProgressRef.current || movingPieceId) return;
    const stateFingerprint = JSON.stringify({ pieces, turnIndex, turnOrderIds, roll, boardItems, ownedItems, trapNodes, shieldedPieceIds, winner, gameStartedAt, pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, itemPromptTiming, branchChoice, rollResultReadyAt, turnOrderPhase });
    if (lastSavedStateFingerprintRef.current === stateFingerprint || savingStateFingerprintRef.current === stateFingerprint) return;
    savingStateFingerprintRef.current = stateFingerprint;
    const pendingSequenceMeta = pendingSequenceMetaRef.current;
    pendingSequenceMetaRef.current = null;
    const sequenceType = pendingSequenceMeta?.type ?? (winner ? 'game_finished' : lastMovedSeatId === localSeatId ? 'move_piece_resolved' : pendingTrapPlacement?.ownerId === localSeatId ? 'item_used' : 'state_snapshot');
    const sequenceActorId = pendingSequenceMeta?.actorId ?? localSeatId;
    const sequencePayload = pendingSequenceMeta?.payload ?? { turnIndex, activeSeatId: activeSeat?.id ?? '', rollName: roll?.name ?? null, lastMovedPieceIds, lastMovedSeatId };
    const clientMutationId = pendingSequenceMeta?.clientMutationId ?? `${sequenceType}:${sequenceActorId}:${stateFingerprint}`;
    void saveGameState(activeRoomId, { pieces, turnIndex, turnOrderIds, roll, boardItems, ownedItems, trapNodes, shieldedPieceIds, logs, winner, captureEffect, trapEffect, gameStartedAt, turnOrderIntro, pendingTrapPlacement, rollLockUntil, lastMovedPieceIds, lastMovedSeatId, itemPromptTiming, branchChoice, rollResultReadyAt, turnOrderPhase }, { type: sequenceType, actorId: sequenceActorId, clientMutationId, payload: sequencePayload }).then((version) => {
      if (version) {
        lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, version);
        lastSavedStateFingerprintRef.current = stateFingerprint;
      }
    }).finally(() => {
      if (savingStateFingerprintRef.current === stateFingerprint) savingStateFingerprintRef.current = '';
    });
  }, [activeRoomId, activeSeat?.id, activeSeat?.isAI, boardItems, branchChoice, captureEffect, gameStartedAt, isRoomHost, isSpectator, lastMovedPieceIds, lastMovedSeatId, localSeatId, logs, movingPieceId, ownedItems, pendingTrapPlacement, pieces, roll, rollLockUntil, rollResultReadyAt, screen, shieldedPieceIds, trapEffect, trapNodes, turnIndex, turnOrderIds, turnOrderIntro, turnOrderPhase, winner, itemPromptTiming]);

  useEffect(() => {
    if (playMode === 'team' && maxPlayers !== 4) setMaxPlayers(4);
  }, [maxPlayers, playMode]);

  useEffect(() => {
    if (!itemPromptTiming) return undefined;
    const timer = window.setTimeout(() => setItemPromptTiming(null), 10000);
    return () => window.clearTimeout(timer);
  }, [itemPromptTiming]);

  useEffect(() => {
    if (screen !== 'game' || !gameStartedAt) return undefined;
    setPlayTimeNow(Date.now());
    if (winner) return undefined;
    const timer = window.setInterval(() => setPlayTimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [gameStartedAt, screen, winner]);

  useEffect(() => {
    if (!turnOrderPhase.active) return undefined;
    setTurnOrderClock(Date.now());
    const timer = window.setInterval(() => setTurnOrderClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [turnOrderPhase.active, turnOrderPhase.index, turnOrderPhase.deadline]);

  useEffect(() => {
    if (!turnOrderPhase.active || !playableSeats.length) return undefined;
    const rolledSeatIds = new Set(turnOrderPhase.rolls.map((rollEntry) => rollEntry.seat.id));
    const allSeatsRolled = playableSeats.every((seat) => rolledSeatIds.has(seat.id));
    if (!allSeatsRolled) return undefined;
    const delayMs = Math.max(0, turnOrderPhase.deadline - Date.now());
    const timer = window.setTimeout(() => finishTurnOrderCeremony(turnOrderPhase.rolls), delayMs);
    return () => window.clearTimeout(timer);
  }, [playableSeats, turnOrderPhase]);

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
    if (rollLockUntil <= Date.now()) return undefined;
    setRollLockClock(Date.now());
    const timer = window.setInterval(() => setRollLockClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [rollLockUntil]);

  useEffect(() => {
    if (rollResultReadyAt <= Date.now()) return undefined;
    setRollLockClock(Date.now());
    const timer = window.setInterval(() => setRollLockClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [rollResultReadyAt]);

  useEffect(() => {
    if (screen === 'game' && roll && isMyTurn && !movingPieceId) showItemPrompt('after_roll');
  }, [roll]);

  useEffect(() => {
    if (screen === 'game' && lastMovedSeatId === localSeatId && !movingPieceId) showItemPrompt('after_move');
  }, [lastMovedPieceIds, lastMovedSeatId, localSeatId]);


  useEffect(() => {
    if (screen !== 'game' || !activeSeat || winner || turnOrderPhase.active || turnOrderIntro) { setTurnToast(null); return undefined; }
    const nextTurnToast = { id: Date.now(), text: `${activeSeat.label}-${activeSeat.name} 차례` };
    setTurnToast(nextTurnToast);
    const timer = window.setTimeout(() => setTurnToast((current) => current?.id === nextTurnToast.id ? null : current), 3000);
    return () => window.clearTimeout(timer);
  }, [activeSeat?.id, activeSeat?.label, activeSeat?.name, screen, turnIndex, turnOrderIntro, winner]);

  useEffect(() => {
    if (screen !== 'game' || winner || turnOrderPhase.active || turnOrderIntro || itemPromptTiming || !activeSeat || !activeSeat.isAI || isMyTurn || roll || movingPieceId || pendingTrapPlacement) return undefined;
    if (activeRoomId && !isRoomHost) return undefined;
    const actionKey = `${activeSeat.id}:${turnIndex}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`;
    if (aiTurnActionKeyRef.current === actionKey) return undefined;
    const timer = window.setTimeout(() => {
      if (aiTurnActionKeyRef.current === actionKey) return;
      aiTurnActionKeyRef.current = actionKey;
      void autoPlayTurn(activeSeat, actionKey);
    }, TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeRoomId, activeSeat, isMyTurn, isRoomHost, itemPromptTiming, lastMovedPieceIds, lastMovedSeatId, movingPieceId, pendingTrapPlacement, pieces, roll, screen, turnIndex, turnOrderIntro, turnOrderPhase.active, winner]);


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
    if (activeRoomId && !isRoomHost) return undefined;
    const timers = playableSeats
      .filter((seat) => seat.isAI && !rolledTurnOrderSeatIds.has(seat.id))
      .map((seat) => window.setTimeout(() => rollForTurnOrder(false, seat.id), Math.max(0, turnOrderPhase.readyAt - Date.now()) + TURN_ORDER_AI_MIN_DELAY_MS + Math.random() * TURN_ORDER_AI_DELAY_SPREAD_MS));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeRoomId, isRoomHost, playableSeats, rolledTurnOrderSeatIds, turnOrderPhase]);


  useEffect(() => {
    if (!turnOrderPhase.active || turnOrderPhase.readyAt > turnOrderClock || turnOrderPhase.deadline <= 0) return;
    if (activeRoomId && !isRoomHost) return;
    if (turnOrderClock < turnOrderPhase.deadline) return;
    finishTurnOrderCeremony(turnOrderPhase.rolls);
  }, [activeRoomId, isRoomHost, turnOrderClock, turnOrderPhase]);

  useEffect(() => {
    if (!turnOrderPhase.active || turnOrderPhase.deadline <= 0 || !isTurnOrderFallbackDue) return;
    if (activeRoomId && !isRoomHost) return;
    finishTurnOrderCeremony(turnOrderPhase.rolls);
  }, [activeRoomId, isRoomHost, isTurnOrderFallbackDue, turnOrderPhase]);

  useEffect(() => {
    if (!showBottomBranchControls || !selectedPiece || !roll) {
      lastBranchControlKeyRef.current = '';
      return;
    }
    const branchControlKey = `${selectedPiece.id}:${selectedPiece.nodeId}:${roll.name}:${roll.steps}`;
    if (lastBranchControlKeyRef.current === branchControlKey) return;
    lastBranchControlKeyRef.current = branchControlKey;
    setBranchChoice('shortcut');
  }, [roll, selectedPiece, showBottomBranchControls]);


  useEffect(() => {
    if (!roll || !activeSeat || !isMyTurn || movingPieceId || winner || rollResultHolding || pendingTrapPlacement) return;
    const steps = roll.steps;
    const movablePieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (steps >= 0 || piece.started));
    if (movablePieces.length === 0) {
      const timer = window.setTimeout(() => {
        addLog(steps < 0 ? `${activeSeat.label}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.` : `${activeSeat.label}은(는) 이동할 말이 없습니다.`);
        setBranchChoice('outer');
        clearRoll();
        setTurnIndex((current) => (current + 1) % playableSeats.length);
      }, TURN_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    const movableGroups = Array.from(new Map(movablePieces.map((piece) => [piece.started ? piece.nodeId : piece.id, piece])).values());
    if (movableGroups.length !== 1 && movableGroups.some((piece) => piece.started)) return;
    const onlyPiece = movableGroups[0];
    const needsBranchChoice = onlyPiece.started && BRANCH_NODE_IDS.includes(onlyPiece.nodeId as typeof BRANCH_NODE_IDS[number]);
    if (needsBranchChoice) return;
    setSelectedPieceId(onlyPiece.id);
    const timer = window.setTimeout(() => { void movePiece(onlyPiece.id, roll, activeSeat); }, AUTO_SINGLE_MOVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeSeat, isMyTurn, movingPieceId, pieces, playableSeats.length, roll, winner, rollResultHolding, pendingTrapPlacement]);

  useEffect(() => {
    if (screen !== 'waitingRoom' || countdown < 0) return undefined;
    if (!allReady) { setCountdown(-1); setMessage('준비가 해제되어 게임 시작이 취소되었습니다.'); return undefined; }
    if (countdown === 0) { startLocalGame(); return undefined; }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [allReady, countdown, screen]);

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
    if (!activeRoomId || !isRoomHost || screen !== 'game') return undefined;
    return subscribePendingGameActions(activeRoomId, (actions) => {
      actions.forEach((action) => { void handleRemoteGameAction(action); });
    });
  }, [activeRoomId, isRoomHost, screen, activeSeat?.id, roll, movingPieceId, pendingTrapPlacement, turnOrderIntro, winner, lastMovedSeatId, turnOrderPhase]);

  const getLocalActionKey = (type: GameAction['type'], payload: Record<string, unknown> = {}) => {
    const turnKey = `${turnIndex}:${roll ? `${roll.name}:${roll.steps}` : 'ready'}:${lastMovedSeatId}:${lastMovedPieceIds.join(',')}`;
    if (type === 'roll_yut') return `${type}:${localSeatId}:${turnKey}`;
    if (type === 'move_piece') return `${type}:${localSeatId}:${turnKey}:${payload.pieceId ?? ''}:${payload.extraSteps ?? 0}:${payload.branchChoice ?? ''}`;
    if (type === 'turn_order_roll') return `${type}:${localSeatId}:${turnOrderPhase.index}:${turnOrderPhase.rolls.length}`;
    if (type === 'place_trap') return `${type}:${localSeatId}:${pendingTrapPlacement?.pieceId ?? ''}:${payload.nodeId ?? ''}`;
    return `${type}:${localSeatId}:${turnKey}:${payload.itemType ?? ''}:${payload.pieceId ?? ''}`;
  };

  function getActorLogName(seat: Seat | undefined) {
    if (!seat) return '';
    return `${seat.label}-${seat.name}`;
  }

  function withActorLogPayload(payload: Record<string, unknown> = {}, seat: Seat | undefined = getSeatById(localSeatId)) {
    return { ...payload, actorLabel: seat?.label ?? '', actorName: seat?.name ?? '', actorLogName: getActorLogName(seat) };
  }

  async function submitRemoteAction(type: GameAction['type'], payload: Record<string, unknown> = {}) {
    if (!activeRoomId) return;
    const clientActionId = String(payload.clientActionId ?? getLocalActionKey(type, payload));
    await submitGameAction(activeRoomId, { type, actorId: localSeatId, payload: withActorLogPayload({ ...payload, clientActionId }) });
  }

  function submitLocalRemoteActionOnce(type: GameAction['type'], payload: Record<string, unknown> = {}) {
    const actionKey = getLocalActionKey(type, payload);
    if (pendingLocalRemoteActionsRef.current.has(actionKey)) return false;
    pendingLocalRemoteActionsRef.current.add(actionKey);
    void submitRemoteAction(type, { ...payload, clientActionId: actionKey }).catch(() => {
      pendingLocalRemoteActionsRef.current.delete(actionKey);
    });
    return true;
  }

  function retryRemoteGameAction(action: GameAction) {
    if (remoteActionRetryTimersRef.current.has(action.id)) return;
    const timer = window.setTimeout(() => {
      remoteActionRetryTimersRef.current.delete(action.id);
      void handleRemoteGameAction(action);
    }, 250);
    remoteActionRetryTimersRef.current.set(action.id, timer);
  }

  async function handleRemoteGameAction(action: GameAction) {
    if (!activeRoomId || completedActionIdsRef.current.has(action.id) || processingActionIdsRef.current.has(action.id)) return;
    const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
    if (clientActionId && processedClientActionIdsRef.current.has(clientActionId)) {
      completedActionIdsRef.current.add(action.id);
      await markGameActionProcessed(activeRoomId, action.id);
      return;
    }
    processingActionIdsRef.current.add(action.id);
    let shouldMarkProcessed = false;
    let shouldRetry = false;
    try {
      const actorSeat = playableSeats.find((seat) => seat.id === action.actorId);
      const isActorsTurn = activeSeat?.id === action.actorId;
      const remoteItemType = action.payload?.itemType as ItemType | undefined;
      const isPostMoveItem = action.type === 'use_item' && (remoteItemType === 'shield' || remoteItemType === 'trap');
      const isTrapPlacementAction = action.type === 'place_trap' && pendingTrapPlacement?.ownerId === action.actorId;
      const canProcessDuringMove = !movingPieceId;
      const canActorAct = Boolean(actorSeat && !winner && canProcessDuringMove && !turnOrderIntro && (isActorsTurn || (isPostMoveItem && lastMovedSeatId === action.actorId) || isTrapPlacementAction));

      if (action.type === 'turn_order_roll') {
        const hasActorAlreadyRolled = turnOrderPhase.rolls.some((rollEntry) => rollEntry.seat.id === action.actorId);

        if (turnOrderPhase.active && !actorSeat) {
          shouldRetry = true;
        } else if (turnOrderPhase.active && Date.now() < turnOrderPhase.readyAt) {
          shouldRetry = true;
        } else if (turnOrderPhase.active && actorSeat && !hasActorAlreadyRolled) {
          rollForTurnOrder(true, action.actorId);
          shouldMarkProcessed = true;
        } else if (turnOrderPhase.active && hasActorAlreadyRolled) {
          shouldMarkProcessed = true;
        } else if (turnOrderIntro || gameStartedAt) {
          shouldMarkProcessed = true;
        }
        return;
      }

      if (!actorSeat) { shouldRetry = true; return; }
      if (!canActorAct) {
        shouldRetry = true;
        return;
      }
      if (action.type !== 'place_trap' && pendingTrapPlacement) { shouldRetry = true; return; }

      if (action.type === 'roll_yut') {
        if (isActorsTurn && !roll) {
          setShieldedPieceIds([]);
          const remoteRoll = rollYutFor(actorSeat, (action.payload?.forcedResult as YutResult | null | undefined) ?? null);
          if (!remoteRoll) { shouldRetry = true; return; }
        }
        shouldMarkProcessed = true;
      }
      if (action.type === 'move_piece') {
        if (!isActorsTurn || !roll) { shouldRetry = true; return; }
        await movePiece(String(action.payload?.pieceId ?? ''), roll, actorSeat, Number(action.payload?.extraSteps ?? 0), (action.payload?.branchChoice as BranchChoice | undefined) ?? branchChoice);
        shouldMarkProcessed = true;
      }
      if (action.type === 'use_item') {
        useItem(remoteItemType as ItemType, action.actorId, action.payload ?? {});
        shouldMarkProcessed = true;
      }
      if (action.type === 'place_trap') {
        if (!pendingTrapPlacement || pendingTrapPlacement.ownerId !== action.actorId) { shouldRetry = true; return; }
        placePendingTrap(String(action.payload?.nodeId ?? ''), action.actorId);
        shouldMarkProcessed = true;
      }
    } finally {
      if (shouldMarkProcessed) {
        const retryTimer = remoteActionRetryTimersRef.current.get(action.id);
        if (retryTimer) window.clearTimeout(retryTimer);
        remoteActionRetryTimersRef.current.delete(action.id);
        completedActionIdsRef.current.add(action.id);
        if (clientActionId) processedClientActionIdsRef.current.add(clientActionId);
        await markGameActionProcessed(activeRoomId, action.id);
      }
      processingActionIdsRef.current.delete(action.id);
      if (!shouldMarkProcessed && shouldRetry) retryRemoteGameAction(action);
    }
  }

  async function leavePreviousOnlineRoom(nextRoomId = '') {
    const previousRoomId = activeRoomIdRef.current || window.localStorage.getItem(STORAGE_KEYS.activeRoomId) || '';
    const roomUser = userRef.current ?? currentUser;
    if (!previousRoomId || previousRoomId === nextRoomId || !isFirebaseConfigured || !roomUser) return;
    try {
      const previousRoom = await getRoom(previousRoomId);
      if (!previousRoom) return;
      if (previousRoom.hostId === roomUser.uid) await deleteRoom(previousRoomId);
      else await removeRoomPlayer(previousRoomId, roomUser.uid);
    } catch (error) {
      console.warn('이전 방 정리에 실패했습니다.', error);
    } finally {
      if (activeRoomIdRef.current === previousRoomId) setActiveRoomId('');
      window.localStorage.removeItem(STORAGE_KEYS.activeRoomId);
      window.localStorage.removeItem(STORAGE_KEYS.isRoomHost);
    }
  }

  async function handleCreateRoom() {
    if (!nickname.trim()) { setMessage('닉네임을 먼저 정해주세요.'); return; }
    if (isCreatingRoom) return;
    setIsCreatingRoom(true);
    setMessage(isFirebaseConfigured && !currentUser ? '입장 준비를 마친 뒤 방을 만드는 중입니다...' : '방을 만드는 중입니다. 잠시만 기다려주세요...');
    let roomHost = userRef.current ?? currentUser;
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('CREATE_ROOM_TIMEOUT')), CREATE_ROOM_TIMEOUT_MS));
      if (!isFirebaseConfigured) {
        await openWaitingRoom({ title, itemMode, maxPlayers, playMode, pieceCount }, '', true);
        return;
      }
      roomHost = roomHost ?? await Promise.race([signInAsGuest(), timeout]);
      if (!roomHost) throw new Error('입장 준비가 끝난 뒤 다시 시도하세요.');
      rememberUser(roomHost);
      await leaveDuplicatePlayerRooms(roomHost.uid);
      await leavePreviousOnlineRoom();
      const roomId = await Promise.race([createRoom({ title, hostId: roomHost.uid, nickname, maxPlayers, itemMode, playMode, pieceCount }), timeout]);
      await openWaitingRoom({ id: roomId, title, itemMode, maxPlayers, playMode, pieceCount }, '', true);
    } catch (error) {
      if (isFirebaseConfigured && roomHost && error instanceof Error && error.message === 'CREATE_ROOM_TIMEOUT') {
        setMessage('응답이 지연되어 생성된 방을 확인하고 있습니다...');
        const recoveredRoom = await findActiveRoomByHost(roomHost.uid);
        if (recoveredRoom) {
          await openWaitingRoom(recoveredRoom, '방 생성은 완료되어 대기실로 이동했습니다.', true);
        } else {
          setMessage('방 만들기 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
        }
      } else {
        setMessage(error instanceof Error ? error.message : '방 생성에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
      }
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function openWaitingRoom(room: Pick<RoomSummary, 'title' | 'itemMode' | 'maxPlayers' | 'playMode' | 'pieceCount'> & { id?: string }, nextMessage = '', asHost = false) {
    setMessage('방으로 이동하는 중입니다...');
    const nextMaxPlayers = room.maxPlayers as 2 | 3 | 4;
    try {
      const roomUser = userRef.current ?? currentUser;
      const joiningUser = !asHost && room.id && isFirebaseConfigured ? roomUser ?? await Promise.race([
        signInAsGuest(),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('JOIN_ROOM_TIMEOUT')), CREATE_ROOM_TIMEOUT_MS)),
      ]) : roomUser;
      if (!asHost && room.id && isFirebaseConfigured && !joiningUser) throw new Error('입장 준비가 끝난 뒤 다시 시도하세요.');
      if (joiningUser) rememberUser(joiningUser);
      if (joiningUser && room.id) await leaveDuplicatePlayerRooms(joiningUser.uid, room.id);
      await leavePreviousOnlineRoom(room.id ?? '');
      const joinResult = !asHost && room.id && joiningUser ? await joinRoom(room.id, { userId: joiningUser.uid, nickname, playMode: room.playMode }) : null;
      setActiveRoomId(room.id ?? '');
      setIsRoomHost(asHost);
      setActiveRoomTitle(room.title);
      setPlayMode(room.playMode);
      setMaxPlayers(nextMaxPlayers);
      setItemMode(room.itemMode);
      setPieceCount(room.pieceCount ?? 4);
      const nextSeats = createSeats(nickname, room.playMode, nextMaxPlayers);
      if (joinResult?.role === 'player' && joiningUser) {
        setSeats(seatsWithJoinedPlayer([], joiningUser.uid, nickname, room.playMode, nextMaxPlayers, joinResult.seatIndex));
      } else {
        setSeats(nextSeats);
      }
      setScreen(room.id && !asHost && 'status' in room && (room as RoomSummary).status === 'playing' ? 'game' : 'waitingRoom');
      setMessage(nextMessage);
    } catch (error) {
      setActiveRoomId('');
      setIsRoomHost(false);
      setActiveRoomTitle('');
      setScreen('lobby');
      setMessage(error instanceof Error ? error.message : '방 참가에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
    }
  }

  function handleStartGame() {
    if (!canManageRoom) { setMessage('방장 정보를 확인하는 중입니다. 잠시 뒤 다시 시도해주세요.'); return; }
    if (!isRoomHost) setIsRoomHost(true);
    if (!allReady) { setMessage(playMode === 'team' && !teamBalanced ? '팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.' : '아직 준비하지 않은 플레이어가 있습니다.'); return; }
    setCountdown(3); setScreen('waitingRoom'); setMessage('');
  }

  function getTurnOrderScore(result: YutResult) {
    if (result.name === '빽도') return 0;
    return result.steps;
  }

  function resolveTurnOrderRolls(targetSeats: Seat[], rollOffRound = 1): TurnOrderRoll[] {
    const firstRolls = targetSeats.map((seat) => ({ ...rollYutResult(undefined, false), seat }));
    const grouped = firstRolls.reduce<Record<number, typeof firstRolls>>((acc, rollEntry) => {
      const score = getTurnOrderScore(rollEntry.result);
      return { ...acc, [score]: [...(acc[score] ?? []), rollEntry] };
    }, {});

    return Object.entries(grouped)
      .flatMap(([score, entries]) => {
        if (entries.length === 1) return [{ seat: entries[0].seat, result: entries[0].result, rollOffRound }];
        addLog(`${entries.map((entry) => entry.seat.label).join(', ')}이(가) ${entries[0].result.name}로 비겨 재윷을 던집니다.`);
        return resolveTurnOrderRolls(entries.map((entry) => entry.seat), rollOffRound + 1);
      })
      .sort((left, right) => getTurnOrderScore(right.result) - getTurnOrderScore(left.result));
  }

  function getTurnOrderFromRolls(rolls: TurnOrderRoll[]) {
    const rankedRolls = [...rolls].sort((left, right) => getTurnOrderScore(right.result) - getTurnOrderScore(left.result));
    const turnOrder = playMode === 'team'
      ? (() => {
        const teamRankings = {
          청팀: rankedRolls.filter((entry) => entry.seat.team === '청팀'),
          홍팀: rankedRolls.filter((entry) => entry.seat.team === '홍팀'),
        };
        const firstTeam: Team = getTurnOrderScore((teamRankings.청팀[0] ?? rankedRolls[0]).result) >= getTurnOrderScore((teamRankings.홍팀[0] ?? rankedRolls[0]).result) ? '청팀' : '홍팀';
        const secondTeam: Team = firstTeam === '청팀' ? '홍팀' : '청팀';
        return [0, 1].flatMap((index) => [teamRankings[firstTeam][index], teamRankings[secondTeam][index]].filter(Boolean)).map((entry) => entry.seat);
      })()
      : rankedRolls.map((entry) => entry.seat);
    return { rankedRolls, turnOrder };
  }

  function getTurnOrderLogTexts(rankedRolls: TurnOrderRoll[], turnOrder: Seat[]) {
    const rollSummary = rankedRolls.map((entry) => `${entry.seat.label} ${entry.result.name}${entry.rollOffRound > 1 ? `(${entry.rollOffRound}차)` : ''}`).join(' · ');
    return [
      `순서 정하기: ${rollSummary}`,
      `차례 순서: ${turnOrder.map((seat, index) => `${index + 1}. ${seat.label}-${seat.name}`).join(' / ')}`,
    ];
  }

  function decideTurnOrder(rolls = resolveTurnOrderRolls(playableSeats)) {
    const { rankedRolls, turnOrder } = getTurnOrderFromRolls(rolls);
    addLogs(getTurnOrderLogTexts(rankedRolls, turnOrder));
    setTurnOrderIds(turnOrder.map((seat) => seat.id));
    return turnOrder;
  }

  function resetGameBoard(nextPieces: BoardPiece[]) {
    setPieces(nextPieces);
    setBoardItems(itemMode ? spawnInitialBoardItems(4, 8) : []);
    setOwnedItems({}); setTrapNodes([]); setShieldedPieceIds([]); setLastMovedPieceIds([]); setLastMovedSeatId(''); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); clearRoll(); setForcedRoll(null); setGoldenYutPickerOpen(false); setItemPromptTiming(null); setBranchChoice('outer'); setCaptureEffect(null); setTrapEffect(null); setPendingTrapPlacement(null);
  }

  function shuffleSeatsForGame(targetSeats: Seat[]) {
    const shuffledSeats = [...targetSeats];
    for (let index = shuffledSeats.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledSeats[index], shuffledSeats[swapIndex]] = [shuffledSeats[swapIndex], shuffledSeats[index]];
    }
    return shuffledSeats;
  }

  function startLocalGame() {
    const orderedSeats = shuffleSeatsForGame(playableSeats);
    const nextPieces = makePieces(orderedSeats, pieceCount, playMode);
    const nextBoardItems = itemMode ? spawnInitialBoardItems(4, 8) : [];
    const nextTurnOrderIds = orderedSeats.map((seat) => seat.id);
    const order = orderedSeats.map((seat) => ({ seatId: seat.id, label: seat.label, name: seat.name, color: playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat) }));
    const nextTurnOrderIntro = { order, visible: true, readyAt: Date.now() + TURN_ORDER_REVEAL_MS };
    const nextGameStartedAt = nextTurnOrderIntro.readyAt;
    const orderText = orderedSeats.map((seat, index) => `${index + 1}. ${seat.label}-${seat.name}`).join(' / ');
    const introLog = makeLog(`랜덤 차례 순서: ${orderText}`);
    resetGameBoard(nextPieces);
    setBoardItems(nextBoardItems);
    setLogs([introLog]);
    setTurnOrderIds(nextTurnOrderIds);
    setTurnOrderIntro(nextTurnOrderIntro);
    setTurnOrderPhase({ active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 });
    setGameStartedAt(nextGameStartedAt);
    setScreen('game');
    if (activeRoomId && canManageRoom) {
      const initialTurnOrderPhase = { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 };
      const initialSyncedState = {
        pieces: nextPieces,
        turnIndex: 0,
        turnOrderIds: nextTurnOrderIds,
        roll: null,
        boardItems: nextBoardItems,
        ownedItems: {},
        trapNodes: [],
        shieldedPieceIds: [],
        logs: [introLog],
        winner: '',
        captureEffect: null,
        trapEffect: null,
        gameStartedAt: nextGameStartedAt,
        turnOrderIntro: nextTurnOrderIntro,
        pendingTrapPlacement: null,
        rollLockUntil: 0,
        lastMovedPieceIds: [],
        lastMovedSeatId: '',
        itemPromptTiming: null,
        branchChoice: 'outer',
        rollResultReadyAt: 0,
        turnOrderPhase: initialTurnOrderPhase,
      };
      const initialStateFingerprint = JSON.stringify({
        pieces: nextPieces,
        turnIndex: 0,
        turnOrderIds: nextTurnOrderIds,
        roll: null,
        boardItems: nextBoardItems,
        ownedItems: {},
        trapNodes: [],
        shieldedPieceIds: [],
        winner: '',
        gameStartedAt: nextGameStartedAt,
        pendingTrapPlacement: null,
        rollLockUntil: 0,
        lastMovedPieceIds: [],
        lastMovedSeatId: '',
        itemPromptTiming: null,
        branchChoice: 'outer',
        rollResultReadyAt: 0,
        turnOrderPhase: initialTurnOrderPhase,
      });
      savingStateFingerprintRef.current = initialStateFingerprint;
      void saveGameState(activeRoomId, initialSyncedState, {
        type: 'game_initialized',
        actorId: localSeatId,
        clientMutationId: `game_initialized:${activeRoomId}`,
        expectedPreviousSequence: 0,
        payload: { turnOrderIds: nextTurnOrderIds },
      }).then((version) => {
        if (version) lastSavedStateFingerprintRef.current = initialStateFingerprint;
        return updateRoomStatus(activeRoomId, 'playing');
      }).finally(() => {
        if (savingStateFingerprintRef.current === initialStateFingerprint) savingStateFingerprintRef.current = '';
      });
    }
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
      .map((seat) => `${seat.label}이(가) 시간 초과로 자동 순서 정하기 굴림 처리되었습니다.`);
    const completedRolls = completeTurnOrderRolls(sourceRolls);
    const { rankedRolls, turnOrder: orderedSeats } = getTurnOrderFromRolls(completedRolls);
    const nextPieces = makePieces(orderedSeats, pieceCount, playMode);
    const nextTurnOrderPhase = { active: false, index: 0, rolls: completedRolls, deadline: 0, readyAt: 0 };
    const nextTurnOrderIds = orderedSeats.map((seat) => seat.id);
    const nextBoardItems = itemMode ? spawnInitialBoardItems(4, 8) : [];
    const order = orderedSeats.map((seat) => ({ seatId: seat.id, label: seat.label, name: seat.name, color: playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat) }));
    const nextTurnOrderIntro = { order, visible: true, readyAt: Date.now() + TURN_ORDER_REVEAL_MS };
    const nextGameStartedAt = nextTurnOrderIntro.readyAt;
    const orderText = orderedSeats.map((seat, index) => `${index + 1}. ${seat.label}-${seat.name}`).join('\n');
    const finalOrderLog = `최종 차례 순서: ${orderText.replace(/\n/g, ' / ')}`;
    const ceremonyLogs = [...timeoutLogTexts, ...getTurnOrderLogTexts(rankedRolls, orderedSeats), finalOrderLog].reverse().map((text) => makeLog(text));

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
        roll: null,
        logs: [...ceremonyLogs, ...currentLogs],
        winner: '',
        captureEffect: null,
        trapEffect: null,
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
    if (activeRoomId && !isRoomHost) return;

    const { local } = makeTurnOrderCeremonyPatch(rolls, logs);
    setPieces(local.nextPieces);
    setBoardItems(local.nextBoardItems);
    setOwnedItems({}); setTrapNodes([]); setShieldedPieceIds([]); setLastMovedPieceIds([]); setLastMovedSeatId(''); setRevealedItems([]); setSelectedPieceId(local.nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); clearRoll(); setForcedRoll(null); setGoldenYutPickerOpen(false); setItemPromptTiming(null); setBranchChoice('outer'); setCaptureEffect(null); setTrapEffect(null); setPendingTrapPlacement(null);
    setTurnOrderIds(local.nextTurnOrderIds);
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
    const logText = `${seat.label}이(가) 순서 정하기에서 ${rolled.result.name}(${getTurnOrderScore(rolled.result)}점)를 던졌습니다.`;

    if (activeRoomId && !isRoomHost && !fromRemote) {
      if (requestedSeatId !== localSeatId) return;
      void submitRemoteAction('turn_order_roll');
      return;
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
  function addLogs(texts: string[]) {
    setLogs((current) => {
      const uniqueTexts = texts.filter((text, index) => texts.indexOf(text) === index && !shouldSuppressDuplicateLog(text, current));
      return [...uniqueTexts].reverse().map((text) => makeLog(text)).concat(current);
    });
  }
  function renderLogText(text: string) {
    const escapedSeatTokens = playableSeats.flatMap((seat) => [seat.id, seat.label]).filter(Boolean).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!escapedSeatTokens.length) return text;
    return text.split(new RegExp(`(?<![\\p{L}\\p{N}_-])(${escapedSeatTokens.join('|')})(?![\\p{L}\\p{N}_-])`, 'gu')).map((part, index) => {
      const seat = playableSeats.find((candidate) => candidate.id === part || candidate.label === part);
      if (!seat) return part;
      const color = playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat);
      return <span className="log-player-label" style={{ color }} key={`${part}-${index}`}>{getActorLogName(seat)}</span>;
    });
  }

  function showToast(title: string, description?: string, icon?: string) {
    const nextToast = { id: Date.now(), title, description, icon };
    setToast(nextToast);
    playSfx('toast');
    window.setTimeout(() => setToast((current) => current?.id === nextToast.id ? null : current), 4000);
  }
  function getUsableHostItems(timing: ItemTiming) {
    if (movingPieceId || winner) return [];
    if (timing === 'after_roll' && (!isMyTurn || !roll)) return [];
    if (timing === 'after_move' && lastMovedSeatId !== localSeatId) return [];
    return (ownedItems[localSeatId] ?? []).filter((type) => {
      if (ITEM_DEFINITIONS[type].timing !== timing) return false;
      if (type === 'move_minus_one' && roll?.steps === 1) return false;
      if (type === 'shield') return lastMovedPieceIds.some((id) => pieces.some((piece) => piece.id === id && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished));
      if (type === 'trap') return pieces.some((piece) => piece.id === selectedPieceId && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished);
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

  function markPlayerAsAI(playerId: string) {
    setSeats((currentSeats) => {
      const aiName = makeUniqueAIName(currentSeats);
      const targetSeat = currentSeats.find((seat) => seat.id === playerId);
      if (activeRoomId && targetSeat) {
        pendingAiSeatIdsRef.current.add(playerId);
        void updateRoomPlayer(activeRoomId, playerId, { nickname: aiName, ready: true, isAI: true, seatIndex: Number(targetSeat.label.replace('P', '')) - 1, color: ['red', 'blue', 'green', 'yellow'][Number(targetSeat.label.replace('P', '')) - 1] ?? 'black', team: targetSeat.team })
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
  function changeTeam(playerId: string, team: Team) {
    if (activeRoomId) { void updateRoomPlayer(activeRoomId, playerId, { team }); }
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, team } : seat));
  }
  function rollYutFor(seat: Seat, forcedResult: YutResult | null = forcedRoll) {
    if (rollInProgressRef.current || currentRollRef.current) return null;
    rollInProgressRef.current = true;
    setRollInProgress(true);
    const rolled = forcedResult ? { result: forcedResult, sticks: makeDisplaySticks(forcedResult) } : rollYutResult();
    const nextRoll = rolled.result;
    const rollResultReadyAtMs = Date.now() + ROLL_RESULT_HOLD_MS;
    const animationKey = `${turnIndex}:${nextRoll.name}:${nextRoll.steps}:${rollResultReadyAtMs}`;
    setForcedRoll(null);
    setRollResultReadyAt(rollResultReadyAtMs);
    currentRollRef.current = nextRoll;
    setRoll(nextRoll);
    playRollAnimationOnce(nextRoll, rolled.sticks, animationKey);
    pendingSequenceMetaRef.current = { type: 'roll_yut', actorId: seat.id, clientMutationId: `roll_yut:${seat.id}:${turnIndex}:${nextRoll.name}:${Date.now()}`, payload: { turnIndex, activeSeatId: seat.id, rollName: nextRoll.name } };
    playSfx('roll');
    if (nextRoll.bonus) window.setTimeout(() => playSfx('bonus'), 420);
    window.setTimeout(() => {
      rollInProgressRef.current = false;
      setRollInProgress(false);
    }, ROLL_RESULT_HOLD_MS);
    addLog(`${seat.label}이(가) ${nextRoll.name}(${nextRoll.steps}칸)를 던졌습니다.`);
    return nextRoll;
  }
  function rollYut() {
    if (!activeSeat || !canRollNow) return;
    if (activeRoomId) {
      const rollPayload = forcedRoll ? { forcedResult: forcedRoll } : {};
      const actionKey = getLocalActionKey('roll_yut', rollPayload);
      if (pendingLocalRemoteActionsRef.current.has(actionKey)) return;
      pendingLocalRemoteActionsRef.current.add(actionKey);
      setRollInProgress(true);
      rollInProgressRef.current = true;

      const finishPendingRoll = () => {
        pendingLocalRemoteActionsRef.current.delete(actionKey);
        rollInProgressRef.current = false;
        setRollInProgress(false);
      };

      if (!isRoomHost) {
        void submitRemoteAction('roll_yut', { ...rollPayload, clientActionId: actionKey })
          .catch((error) => {
            setMessage(error instanceof Error ? error.message : '윷 던지기 요청을 보내지 못했습니다.');
            finishPendingRoll();
          });
        setForcedRoll(null);
        return;
      }

      void commitAuthoritativeGameAction(activeRoomId, { type: 'roll_yut', actorId: localSeatId, payload: withActorLogPayload({ ...rollPayload, clientActionId: actionKey }, activeSeat) })
        .then((result) => {
          if (result.status === 'rejected' || result.status === 'unsupported') {
            setMessage(result.reason ?? '윷 던지기 처리에 실패했습니다.');
            return;
          }
          if (result.status === 'committed') {
            const committedRoll = result.patch?.roll as YutResult | null | undefined;
            const committedRollResultReadyAt = Number(result.patch?.rollResultReadyAt ?? 0);
            if (committedRoll && !currentRollRef.current) {
              currentRollRef.current = committedRoll;
              setRoll(committedRoll);
              setRollResultReadyAt(committedRollResultReadyAt);
              playRollAnimationOnce(committedRoll, makeDisplaySticks(committedRoll), `${turnIndex}:${committedRoll.name}:${committedRoll.steps}:${committedRollResultReadyAt}`);
              playSfx('roll');
              if (committedRoll.bonus) window.setTimeout(() => playSfx('bonus'), 420);
            }
          }
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : '윷 던지기 처리에 실패했습니다.'))
        .finally(finishPendingRoll);
      setForcedRoll(null);
      return;
    }
    setShieldedPieceIds([]);
    rollYutFor(activeSeat);
  }

  async function movePiece(pieceId: string, result: YutResult, seat: Seat, extraSteps = 0, branchOverride: BranchChoice = branchChoice) {
    if (winner || movingPieceId || moveInProgressRef.current) return false;
    moveInProgressRef.current = true;
    const movingPiece = pieces.find((piece) => piece.id === pieceId && canSeatControlPiece(seat, piece) && !piece.finished);
    if (!movingPiece) { setTurnIndex((current) => (current + 1) % playableSeats.length); clearRoll(); moveInProgressRef.current = false; return false; }
    const steps = result.steps + extraSteps;
    if (steps < 0 && !movingPiece.started) {
      addLog(`${seat.label}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
      setBranchChoice('outer');
      clearRoll();
      setTurnIndex((current) => (current + 1) % playableSeats.length);
      moveInProgressRef.current = false;
      return false;
    }
    if (steps === 0) {
      addLog(`${seat.label} 말은 이동할 칸 수가 없어 제자리에 머뭅니다.`);
      setBranchChoice('outer');
      clearRoll();
      setTurnIndex((current) => (current + 1) % playableSeats.length);
      moveInProgressRef.current = false;
      return true;
    }
    setMovingPieceId(pieceId);
    const movingGroupIds = movingPiece.started
      ? pieces.filter((piece) => canSeatControlPiece(seat, piece) && !piece.finished && piece.started && piece.nodeId === movingPiece.nodeId).map((piece) => piece.id)
      : [movingPiece.id];
    if (movingGroupIds.length > 1) addLog(`${seat.label}의 말 ${movingGroupIds.length}개가 업혀 함께 이동합니다.`);
    if (!movingPiece.started) await delay(STEP_DELAY_MS);
    let nextNodeIndex = movingPiece.nodeIndex;
    let currentNodeId = movingPiece.nodeId;
    let finishedMove = false;
    const movePathNodeIds = getMovePathNodeIds(currentNodeId, steps, getEffectiveBranchChoice(currentNodeId, branchOverride));
    for (let step = 0; step < Math.abs(steps); step += 1) {
      const nextNodeId = movePathNodeIds[step];
      if (steps < 0 && nextNodeId === 'n01' && currentNodeId === 'n02') {
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
      currentNodeId = nextNodeId;
      nextNodeIndex = BOARD_NODES.findIndex((node) => node.id === nextNodeId);
      setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: nextNodeIndex, nodeId: currentNodeId, started: true, finished: false } : piece));
      playSfx('move');
      await delay(STEP_DELAY_MS);
    }

    const landedNode = getBoardNodeById(currentNodeId);
    const landedItem = boardItems.find((item) => item.nodeId === landedNode?.id);
    if (landedItem) {
      const itemName = ITEM_DEFINITIONS[landedItem.type].name;
      const currentItems = ownedItems[seat.id] ?? [];
      if (currentItems.length >= MAX_OWNED_ITEMS && seat.id === localSeatId && !seat.isAI) {
        setPendingItemPickup({ seatId: seat.id, item: landedItem.type, itemId: landedItem.id });
        addLog(`${seat.label}이(가) 아이템 '${itemName}'을 발견했습니다. 보유 한도 때문에 교체를 선택해야 합니다.`);
      } else {
        setOwnedItems((items) => {
          const nextSeatItems = [...(items[seat.id] ?? [])];
          if (nextSeatItems.length >= MAX_OWNED_ITEMS) nextSeatItems.shift();
          return { ...items, [seat.id]: [...nextSeatItems, landedItem.type] };
        });
        setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
        addLog(`${seat.label}이(가) 아이템 '${itemName}'을 획득했습니다.`);
      }
      setRevealedItems((items) => Array.from(new Set([...items, landedItem.type])));
      showToast(itemName, ITEM_DEFINITIONS[landedItem.type].description, ITEM_DEFINITIONS[landedItem.type].icon);
      playSfx('itemPickup');
      setHighlightedNodeId(landedNode?.id ?? '');
      setRollLockUntil(Date.now() + ITEM_PICKUP_ROLL_LOCK_MS);
      window.setTimeout(() => setHighlightedNodeId((current) => current === landedNode?.id ? '' : current), 1400);
    }
    const steppedOnTrap = trapNodes.find((trap) => trap.nodeId === currentNodeId && !isSameSide(getSeatById(trap.ownerId), seat));
    if (steppedOnTrap) {
      setTrapNodes((nodes) => nodes.filter((trap) => trap !== steppedOnTrap));
      const shieldedFromTrap = movingGroupIds.some((id) => shieldedPieceIds.includes(id));
      if (shieldedFromTrap) {
        setShieldedPieceIds((ids) => ids.filter((id) => !movingGroupIds.includes(id)));
        addLog(`${seat.label} 말이 방패로 함정을 막았습니다.`);
        playSfx('shield');
      } else {
        const effect = { id: Date.now(), nodeId: currentNodeId, pieceIds: movingGroupIds };
        setTrapEffect(effect);
        addLog(`${seat.label} 말이 함정을 밟아 폭발했습니다. 잠시 후 시작점으로 돌아갑니다.`);
        playSfx('trap');
        await delay(TRAP_EFFECT_MS);
        setTrapEffect((current) => current?.id === effect.id ? null : current);
        setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false } : piece));
        currentNodeId = 'n01';
        nextNodeIndex = 0;
        await delay(STEP_DELAY_MS);
      }
    }
    let captured = false;
    if (currentNodeId !== 'finish') {
      const capturablePieces = pieces.filter((piece) => !isSameSide(getSeatById(piece.ownerId), seat) && !piece.finished && piece.started && piece.nodeId === currentNodeId);
      const shieldedCaptures = capturablePieces.filter((piece) => shieldedPieceIds.includes(piece.id));
      captured = capturablePieces.some((piece) => !shieldedPieceIds.includes(piece.id));
      if (shieldedCaptures.length) {
        setShieldedPieceIds((ids) => ids.filter((id) => !shieldedCaptures.some((piece) => piece.id === id)));
        addLog('방패가 상대의 잡기를 1회 막았습니다.');
      }
      if (captured) {
        const capturedPieceIds = capturablePieces.filter((piece) => !shieldedPieceIds.includes(piece.id)).map((piece) => piece.id);
        const effect = { id: Date.now(), pieceIds: capturedPieceIds };
        setCaptureEffect(effect);
        playSfx('capture');
        await delay(STEP_DELAY_MS * 2);
        setPieces((currentPieces) => currentPieces.map((piece) => capturedPieceIds.includes(piece.id) ? { ...piece, nodeIndex: 0, nodeId: 'n01', started: false } : piece));
        window.setTimeout(() => setCaptureEffect((current) => current?.id === effect.id ? null : current), 450);
      }
    }
    if (finishedMove) { addLog(`${seat.label} 말이 완주했습니다!`); playSfx('arrive'); }
    const controlledPiecesDone = pieces.filter((piece) => canSeatControlPiece(seat, piece) && piece.id !== pieceId).every((piece) => piece.finished) && finishedMove;
    if (controlledPiecesDone) addLog(`${playMode === 'team' ? seat.team : seat.label}의 모든 말이 완주했습니다.`);
    if (result.bonus && captured) addLog(`${withAndParticle(result.name)} 잡기 보너스로 한 번 더 던질 수 있습니다.`);
    else if (result.bonus) addLog(`${withSubjectParticle(result.name)} 나와 한 번 더 던질 수 있습니다.`);
    else if (captured) addLog('상대 말을 잡아 한 번 더 던질 수 있습니다.');
    else setTurnIndex((current) => (current + 1) % playableSeats.length);
    setLastMovedPieceIds(movingGroupIds);
    setLastMovedSeatId(seat.id);
    setBranchChoice('outer');
    setMovingPieceId('');
    clearRoll();
    moveInProgressRef.current = false;
    return true;
  }

  function moveSelectedPiece(extraSteps = 0) {
    if (!roll || !activeSeat || !canRequestMove) return false;
    const steps = roll.steps + extraSteps;
    const canMovePiece = (piece: BoardPiece) => steps >= 0 || piece.started;
    const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId && canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece));
    const fallbackPiece = pieces.find((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece));
    if (!selectedPiece && fallbackPiece) setSelectedPieceId(fallbackPiece.id);
    if (activeRoomId) {
      const pieceToMove = selectedPiece ?? fallbackPiece;
      const payload = {
        pieceId: pieceToMove?.id ?? '',
        extraSteps,
        branchChoice: getEffectiveBranchChoice(pieceToMove?.nodeId ?? '', branchChoice),
      };
      const actionKey = getLocalActionKey('move_piece', payload);
      if (pendingLocalRemoteActionsRef.current.has(actionKey)) return false;
      pendingLocalRemoteActionsRef.current.add(actionKey);
      if (!isRoomHost) {
        void submitRemoteAction('move_piece', { ...payload, clientActionId: actionKey })
          .catch((error) => {
            setMessage(error instanceof Error ? error.message : '말 이동 요청을 보내지 못했습니다.');
            pendingLocalRemoteActionsRef.current.delete(actionKey);
          });
        return true;
      }
      void commitAuthoritativeGameAction(activeRoomId, { type: 'move_piece', actorId: localSeatId, payload: withActorLogPayload({ ...payload, clientActionId: actionKey }, activeSeat) })
        .then((result) => {
          if (result.status === 'rejected' || result.status === 'unsupported') setMessage(result.reason ?? '말 이동 처리에 실패했습니다.');
        })
        .catch((error) => setMessage(error instanceof Error ? error.message : '말 이동 처리에 실패했습니다.'))
        .finally(() => pendingLocalRemoteActionsRef.current.delete(actionKey));
      return true;
    }
    if (!selectedPiece && !fallbackPiece) {
      if (steps < 0) {
        addLog(`${activeSeat.label}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
        setBranchChoice('outer');
        clearRoll();
        setTurnIndex((current) => (current + 1) % playableSeats.length);
      }
      return false;
    }
    const pieceToMove = selectedPiece ?? fallbackPiece;
    void movePiece(pieceToMove?.id ?? selectedPieceId, roll, activeSeat, extraSteps, getEffectiveBranchChoice(pieceToMove?.nodeId ?? '', branchChoice));
    return true;
  }

  function getAiBranchChoice(piece: BoardPiece): BranchChoice {
    return piece.started && BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? 'shortcut' : 'outer';
  }

  function scoreAiMove(piece: BoardPiece, result: YutResult, seat: Seat, aiBranchChoice: BranchChoice) {
    const steps = result.steps;
    if (steps < 0 && !piece.started) return Number.NEGATIVE_INFINITY;
    const pathNodeIds = getMovePathNodeIds(piece.nodeId, steps, getEffectiveBranchChoice(piece.nodeId, aiBranchChoice));
    const landedNodeId = pathNodeIds[pathNodeIds.length - 1] ?? piece.nodeId;
    const finishes = steps > 0 && pathNodeIds.length < steps;
    const captures = !finishes && pieces.some((target) => !isSameSide(getSeatById(target.ownerId), seat) && target.started && !target.finished && target.nodeId === landedNodeId);
    const stacks = !finishes && piece.started ? pieces.filter((target) => canSeatControlPiece(seat, target) && target.started && !target.finished && target.nodeId === piece.nodeId).length - 1 : 0;
    const startsNewPiece = !piece.started && steps > 0;
    const progress = finishes ? 25 : BOARD_NODES.findIndex((node) => node.id === landedNodeId);
    return (finishes ? 1000 : 0) + (captures ? 400 : 0) + (aiBranchChoice === 'shortcut' ? 80 : 0) + (startsNewPiece ? 60 : 0) + (stacks * 30) + progress - (piece.finished ? 10000 : 0);
  }

  function chooseAiMove(seat: Seat, result: YutResult) {
    return pieces
      .filter((piece) => canSeatControlPiece(seat, piece) && !piece.finished && (result.steps >= 0 || piece.started))
      .map((piece) => {
        const aiBranchChoice = getAiBranchChoice(piece);
        return { piece, branchChoice: aiBranchChoice, score: scoreAiMove(piece, result, seat, aiBranchChoice) };
      })
      .sort((left, right) => right.score - left.score)[0];
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
      const nextRoll = rollYutFor(seat);
      if (!nextRoll) return;
      const aiMove = chooseAiMove(seat, nextRoll);
      if (!aiMove) {
        setTurnIndex((current) => (current + 1) % playableSeats.length);
        clearRoll();
        return;
      }
      setBranchChoice(aiMove.branchChoice);
      await delay(AI_MOVE_DELAY_MS);
      if (!canContinueAiTurn()) return;
      await movePiece(aiMove.piece.id, nextRoll, seat, 0, aiMove.branchChoice);
    } finally {
      clearCurrentAiActionKey();
    }
  }

  function placePendingTrap(nodeId: string, actorId = localSeatId) {
    if (!pendingTrapPlacement || !pendingTrapPlacement.nodeIds.includes(nodeId)) return;
    const itemOwnerSeat = playableSeats.find((seat) => seat.id === pendingTrapPlacement.ownerId);
    const trapPiece = pieces.find((piece) => piece.id === pendingTrapPlacement.pieceId);
    if (!itemOwnerSeat || !trapPiece) { setPendingTrapPlacement(null); return; }
    playSfx('itemUse');
    setOwnedItems((items) => {
      const nextSeatItems = [...(items[pendingTrapPlacement.ownerId] ?? [])];
      const trapIndex = nextSeatItems.indexOf('trap');
      if (trapIndex >= 0) nextSeatItems.splice(trapIndex, 1);
      return { ...items, [pendingTrapPlacement.ownerId]: nextSeatItems };
    });
    setTrapNodes((nodes) => [...nodes.filter((trap) => trap.nodeId !== nodeId), { nodeId, ownerId: pendingTrapPlacement.ownerId }]);
    addLog(`${itemOwnerSeat.label}이(가) ${trapPiece.label} 주변 ${nodeId} 칸에 함정을 설치했습니다.`);
    setPendingTrapPlacement(null);
  }

  function useItem(type: ItemType, actorId = localSeatId, remotePayload: Record<string, unknown> = {}) {
    if (movingPieceId) return;
    const itemOwnerId = actorId;
    const itemOwnerSeat = playableSeats.find((seat) => seat.id === itemOwnerId);
    if (!itemOwnerSeat) return;
    const activeItems = ownedItems[itemOwnerId] ?? [];
    if (!activeItems.includes(type)) return;
    const consumeItem = () => { playSfx('itemUse'); setItemPromptTiming(null); setPendingTrapPlacement(null); setOwnedItems((items) => { const nextSeatItems = [...(items[itemOwnerId] ?? [])]; nextSeatItems.splice(nextSeatItems.indexOf(type), 1); return { ...items, [itemOwnerId]: nextSeatItems }; }); };
    if (type === 'golden_yut') {
      if (activeSeat?.id !== itemOwnerId || roll) { addLog('황금 윷은 내 턴에 윷을 던지기 전에 사용할 수 있습니다.'); return; }
      consumeItem();
      if (actorId === localSeatId) {
        setGoldenYutPickerOpen(true);
        addLog('황금 윷을 사용했습니다. 다음 윷 결과를 선택하세요.');
      } else {
        addLog(`${itemOwnerSeat.label}이(가) 황금 윷을 사용했습니다. 다음 윷 결과를 선택 중입니다.`);
      }
      return;
    }
    if (type === 'reroll') {
      if (activeSeat?.id !== itemOwnerId || !roll) { addLog('다시 던지기는 내 턴에 윷을 던진 뒤 사용할 수 있습니다.'); return; }
      consumeItem();
      clearRoll();
      window.setTimeout(() => rollYutFor(itemOwnerSeat), 450);
      return;
    }
    if (type === 'move_plus_one' || type === 'move_minus_one') {
      if (activeSeat?.id !== itemOwnerId || !roll) { addLog('이동 보정 아이템은 내 턴에 윷을 던진 뒤 사용할 수 있습니다.'); return; }
      if (type === 'move_minus_one' && roll.steps === 1) { addLog('도에서는 한 칸 덜 이동 아이템을 사용할 수 없습니다.'); return; }
      const itemMoveSteps = type === 'move_plus_one' ? 1 : -1;
      if (actorId === localSeatId && !moveSelectedPiece(itemMoveSteps)) return;
      if (actorId !== localSeatId) {
        const remotePieceId = String(remotePayload.pieceId ?? selectedPieceId);
        const remoteBranchChoice = (remotePayload.branchChoice as BranchChoice | undefined) ?? branchChoice;
        void movePiece(remotePieceId, roll, itemOwnerSeat, itemMoveSteps, remoteBranchChoice);
      }
      consumeItem();
      return;
    }
    if (type === 'shield') {
      const shieldTargets = lastMovedSeatId === itemOwnerId ? lastMovedPieceIds.filter((id) => pieces.some((piece) => piece.id === id && canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished)) : [];
      if (!shieldTargets.length) { addLog('방패는 방금 이동한 내 말이 말판 위에 있을 때 사용할 수 있습니다.'); return; }
      consumeItem();
      setShieldedPieceIds((ids) => Array.from(new Set([...ids, ...shieldTargets])));
      addLog(`${itemOwnerSeat.label}의 방금 이동한 말에 방패를 씌웠습니다.`);
      return;
    }
    if (type === 'trap') {
      const trapPieceId = actorId === localSeatId ? selectedPieceId : String(remotePayload.pieceId ?? selectedPieceId);
      const trapPiece = pieces.find((piece) => piece.id === trapPieceId && canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished);
      if (!trapPiece) { addLog('함정은 말판 위에 있는 내 말을 선택한 뒤 설치할 수 있습니다.'); return; }
      if (lastMovedSeatId !== itemOwnerId) { addLog('함정은 내 말이 이동한 직후에 설치할 수 있습니다.'); return; }
      const nodeIds = getNearbyNodeIds(trapPiece.nodeId, 2).filter((nodeId) => nodeId !== 'n01');
      if (!nodeIds.length) { addLog('함정을 설치할 수 있는 칸이 없습니다.'); return; }
      setItemPromptTiming(null);
      setPendingTrapPlacement({ ownerId: itemOwnerId, pieceId: trapPiece.id, nodeIds, deadline: Date.now() + 10000 });
      addLog(`${trapPiece.label} 기준 앞뒤 2칸 이내에서 함정을 설치할 칸을 선택하세요.`);
    }
  }


  async function toggleMyReady() {
    if (isRoomHost) return;
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
    if (screen === 'game' && activeRoomId) {
      addLog(`${nickname}님이 나갔습니다.`);
      await removeRoomPlayer(activeRoomId, localSeatId);
    }
    else if (activeRoomId) await removeRoomPlayer(activeRoomId, localSeatId);
    setScreen('lobby'); setActiveRoomId(''); setActiveRoomTitle(''); setIsRoomHost(false); setCountdown(-1); setTurnOrderIds([]); setGameStartedAt(null); setSeats(createSeats(nickname, playMode, maxPlayers));
    setMessage('방에서 나왔습니다.');
  }

  function finishGame() {
    const finishedRoomId = activeRoomId;
    const wasHost = isRoomHost;
    setScreen('lobby');
    setActiveRoomTitle('');
    setActiveRoomId('');
    setIsRoomHost(false);
    setCountdown(-1);
    setTurnOrderIds([]);
    setGameStartedAt(null);
    setItemPromptTiming(null);
    setSeats(createSeats(nickname, playMode, maxPlayers));
    setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.');
    if (finishedRoomId && wasHost) {
      void deleteRoom(finishedRoomId);
    } else if (finishedRoomId) {
      void removeRoomPlayer(finishedRoomId, localSeatId);
    }
  }

  async function changeWaitingOptions(next: { itemMode?: boolean; pieceCount?: PieceCount; playMode?: PlayMode; maxPlayers?: 2 | 3 | 4 }) {
    const nextPlayMode = next.playMode ?? playMode;
    const nextMaxPlayers = nextPlayMode === 'team' ? 4 : next.maxPlayers ?? maxPlayers;
    const nextItemMode = next.itemMode ?? itemMode;
    const nextPieceCount = next.pieceCount ?? (next.playMode === 'team' && playMode !== 'team' ? 2 : pieceCount);
    const activePlayerCount = seats.filter((seat) => !seat.isEmpty && !seat.isSpectator).length;
    if (nextMaxPlayers < activePlayerCount) {
      setMessage(`현재 참가 인원 ${activePlayerCount}명보다 적게 인원을 줄일 수 없습니다.`);
      return;
    }
    setPlayMode(nextPlayMode);
    setMaxPlayers(nextMaxPlayers);
    setItemMode(nextItemMode);
    setPieceCount(nextPieceCount);
    if (canManageRoom && activeRoomId) await updateRoomOptions(activeRoomId, { playMode: nextPlayMode, maxPlayers: nextMaxPlayers, itemMode: nextItemMode, pieceCount: nextPieceCount });
  }

  function openNicknameDialog() {
    if (screen !== 'lobby') return;
    setNicknameDraft(nickname);
    setNicknameDialogOpen(true);
  }

  function saveNickname() {
    const nextNickname = nicknameDraft.trim();
    if (!nextNickname) { setMessage('닉네임은 비워둘 수 없습니다.'); return; }
    setNickname(nextNickname);
    setNicknameDialogOpen(false);
    setMessage('닉네임이 변경되었습니다.');
  }

  return <main data-testid="app-shell" className={`shell ${screen === 'game' ? 'game-shell' : 'lobby-shell'}`}>
    <section className="hero panel">
      <div className="hero-copy"><h1 className="brand-title">YUT ONLINE</h1></div>
      {screen === 'game' && <div data-testid="play-timer" className={`play-time ${winner ? 'stopped' : ''}`} aria-label={`현재 게임 플레이 타임 ${playTimeText}`}>{playTimeText}</div>}
      <div className="hero-actions"><button className="nickname-chip" type="button" onClick={openNicknameDialog} disabled={screen !== 'lobby'} aria-label={`닉네임 수정: ${nickname}`}>👤 {nickname}</button><div className="sound-controls" aria-label="효과음 설정"><button className={`sound-toggle ${soundEnabled ? 'active' : ''}`} type="button" onClick={() => { const nextEnabled = !soundEnabled; setSoundEnabled(nextEnabled); if (nextEnabled) playSoundEffect('toast', true); }}>{soundEnabled ? '🔊 효과음 ON' : '🔇 효과음 OFF'}</button></div><div className={`status-card ${serverStatusTone}`} aria-label={`서버 상태: ${serverStatus}`}><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><strong>접속</strong><span>{serverStatus}</span></div></div>
    </section>

    {nicknameDialogOpen && screen === 'lobby' && <div className="modal-backdrop" role="presentation" onMouseDown={() => setNicknameDialogOpen(false)}><section className="nickname-modal panel" role="dialog" aria-modal="true" aria-label="닉네임 수정" onMouseDown={(event) => event.stopPropagation()}><p className="section-kicker">닉네임</p><h2>대기실 닉네임 수정</h2><p>닉네임은 대기실에서만 변경할 수 있어요.</p><input value={nicknameDraft} onChange={(e) => setNicknameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setNicknameDialogOpen(false); }} autoFocus maxLength={16} placeholder="닉네임" /><div className="modal-actions"><button onClick={saveNickname}>저장</button><button className="secondary" onClick={() => setNicknameDialogOpen(false)}>취소</button></div></section></div>}

    {screen === 'lobby' && <section className="lobby-layout premium-lobby" aria-label="첫 대기 화면">
      <section className="panel room-panel create-room-panel">
        <div className="lobby-panel-heading">
          <p className="section-kicker">방 만들기</p>
          <h2>새 방을 여세요</h2>
          <span>방 제목만 입력하면 바로 대기실로 이동해 세부 룰을 설정할 수 있어요.</span>
        </div>
        <div className="form-grid lobby-form">
          <label>방 제목<input data-testid="room-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /></label>
          <button data-testid="create-room-button" className="primary-cta" onClick={handleCreateRoom} disabled={isCreatingRoom}>{isCreatingRoom ? <span className="button-loading" aria-hidden="true"></span> : null}{isCreatingRoom ? '방 만드는 중...' : '방 만들기'}</button>
        </div>
        {message && <p className="notice lobby-notice">{message}</p>}
      </section>
      <section className="panel room-panel join-room-panel">
        <div className="lobby-panel-heading">
          <p className="section-kicker">방 참여</p>
          <h2>방 목록</h2>
          <span>{rooms.length ? `${rooms.length}개의 방이 참여 또는 관전을 기다리고 있어요.` : '새 방을 만들거나 친구의 방을 기다려보세요.'}</span>
        </div>
        <div className="room-list lobby-room-list">{rooms.length ? rooms.map((room) => <article className="room-card lobby-room-card" key={room.id}><div><b>{room.title}</b><span>{room.playMode === 'team' ? '팀전' : '개인전'} · {room.currentPlayers ?? 0}/{room.maxPlayers} · 말 {room.pieceCount ?? 4}개 · {room.itemMode ? '아이템 ON' : '아이템 OFF'}</span></div><button disabled={isFirebaseConfigured && !currentUser} onClick={() => { void openWaitingRoom(room); }}>{isFirebaseConfigured && !currentUser ? '입장 준비 중' : room.status === 'playing' ? '관전' : '참여'}</button></article>) : <div className="empty-lobby-room"><strong>아직 열린 방이 없습니다</strong><span>왼쪽에서 방을 만들면 친구들이 바로 참여할 수 있어요.</span></div>}</div>
      </section>
    </section>}

    {screen === 'waitingRoom' && (() => {
      const myWaitingSeat = seats.find((seat) => seat.id === localSeatId && !seat.isEmpty && !seat.isAI);
      const readyMissingCount = seats.filter((seat) => seat.isEmpty || (!seat.ready && !seat.isAI)).length;
      const teamStartHint = playMode === 'team' && !teamBalanced ? `청팀 ${Math.max(0, 2 - teamCounts.청팀)}명, 홍팀 ${Math.max(0, 2 - teamCounts.홍팀)}명이 더 필요해요.` : '';
      const startStatusText = allReady ? '시작 가능' : teamStartHint || `${readyMissingCount}명이 더 준비해야 해요.`;
      const roomRuleText = `${playMode === 'team' ? '팀전' : '개인전'} · ${maxPlayers}인 · ${playMode === 'team' ? `팀별 말 ${pieceCount}개` : `말 ${pieceCount}개`} · 아이템 ${itemMode ? 'ON' : 'OFF'}`;
      return <section data-testid="waiting-room" className={`panel waiting-room compact-waiting-room ${canManageRoom ? 'host-view' : 'player-view'}`} aria-label="방 대기 화면">
        <header className="waiting-header">
          <div>
            <h2 className="room-title">{activeRoomTitle || title}</h2>
            <p className="room-subtitle">{canManageRoom ? '방장은 규칙·팀·AI를 관리하고 게임을 시작할 수 있어요.' : '일반 플레이어는 준비/준비취소와 방 나가기만 할 수 있어요.'}</p>
          </div>
          <div className={`start-status ${allReady ? 'ready' : 'blocked'}`} role="status">
            <strong>{startStatusText}</strong>
            <span>{roomRuleText}</span>
          </div>
        </header>

        <div className="waiting-main-grid">
          {(canManageRoom || playMode === 'team') && <section className="waiting-setup-card" aria-label="방 설정과 시작 조건">
            {playMode === 'team' && <div className="team-checklist" aria-label="팀전 시작 조건"><strong>팀 균형</strong><span className={teamCounts.청팀 === 2 ? 'ok' : ''}>청팀 {teamCounts.청팀}/2</span><span className={teamCounts.홍팀 === 2 ? 'ok' : ''}>홍팀 {teamCounts.홍팀}/2</span></div>}
            {canManageRoom ? <div className="host-room-options compact-options"><fieldset className="radio-group"><legend>진행</legend>{(['individual', 'team'] as PlayMode[]).map((mode) => <label key={mode}><input type="radio" name="playMode" checked={playMode === mode} onChange={() => changeWaitingOptions({ playMode: mode })} />{mode === 'team' ? '팀전' : '개인전'}</label>)}</fieldset><fieldset className="radio-group"><legend>인원</legend>{([2, 3, 4] as const).map((count) => <label key={count} className={playMode === 'team' && count !== 4 ? 'disabled' : ''} title={playMode === 'team' && count !== 4 ? '팀전은 4인만 가능합니다.' : undefined}><input type="radio" name="maxPlayers" checked={maxPlayers === count} disabled={playMode === 'team' && count !== 4} onChange={() => changeWaitingOptions({ maxPlayers: count })} />{count}인</label>)}</fieldset><fieldset className="radio-group"><legend>말</legend>{([1, 2, 3, 4] as const).map((count) => <label key={count}><input type="radio" name="pieceCount" checked={pieceCount === count} onChange={() => changeWaitingOptions({ pieceCount: count })} />{count}개</label>)}</fieldset><fieldset className="radio-group item-mode-group"><legend>아이템</legend>{([true, false] as const).map((enabled) => <label key={String(enabled)}><input type="radio" name="itemMode" checked={itemMode === enabled} onChange={() => changeWaitingOptions({ itemMode: enabled })} />{enabled ? 'ON' : 'OFF'}</label>)}</fieldset></div> : null}
          </section>}

          <section className="ready-list compact-ready-list" aria-label="플레이어 자리">
            {seats.map((seat) => <article className={`ready-card compact-ready-card ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''} ${seat.id === localSeatId ? 'me' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}>
              <div className="seat-topline"><b>{seat.label}</b><span>{seat.isHost ? '방장' : seat.id === localSeatId ? '나' : seat.isEmpty ? '대기' : '참가자'}</span></div>
              <div className="seat-name-row"><strong>{seat.name}</strong><em>{seat.isAI ? 'AI' : seat.isEmpty ? '빈 자리' : seat.ready ? '준비 완료' : '준비 중'}</em></div>
              {playMode === 'team' && <div className="team-card-selector" role="group" aria-label={`${seat.label} 팀 선택`}>{(['청팀', '홍팀'] as Team[]).map((team) => <button type="button" key={team} className={`team-card-option ${team === seat.team ? 'active' : ''} ${team === '청팀' ? 'blue' : 'red'}`} disabled={!canManageRoom} onClick={() => changeTeam(seat.id, team)}>{team}</button>)}</div>}
              {seat.isEmpty && canManageRoom && <button data-testid={`add-ai-${seat.label}`} className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>AI 추가</button>}
              {seat.isAI && canManageRoom && !seat.isHost && <button className="mini-button secondary ai-cancel-button" onClick={() => cancelAISeat(seat.id)}>AI 제거</button>}
            </article>)}
          </section>
        </div>

        {countdown >= 0 && <div className="countdown-scrim" role="presentation"><div className="countdown-overlay" role="status"><span>게임 시작</span><strong>{countdown}</strong>{canManageRoom && <button className="secondary mini-button" onClick={() => { setCountdown(-1); setMessage('시작이 취소되었습니다.'); }}>취소</button>}</div></div>}
        {playMode === 'team' && !teamBalanced && <p className="notice warning inline-warning">팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.</p>}
        <footer className="waiting-actions role-actions">
          {canManageRoom ? <button data-testid="start-game-button" onClick={handleStartGame} disabled={!allReady}>게임 시작</button> : <button onClick={() => { void toggleMyReady(); }} disabled={!myWaitingSeat}>{myWaitingSeat?.ready ? '준비 취소' : '준비 완료'}</button>}
          <button className="secondary" onClick={leaveRoom}>방 나가기</button>
        </footer>
      </section>;
    })()}





    {pendingItemPickup && <div className="modal-backdrop" role="presentation"><section className="nickname-modal panel" role="dialog" aria-modal="true" aria-label="아이템 교체 선택"><p className="section-kicker">아이템 한도</p><h2>아이템을 교체할까요?</h2><p>새 아이템 {ITEM_DEFINITIONS[pendingItemPickup.item].name}을 얻으려면 기존 아이템 하나를 버려야 합니다.</p><div className="inline-item-actions">{(ownedItems[pendingItemPickup.seatId] ?? []).map((type, index) => <button key={`${type}-${index}`} onClick={() => { const pickup = pendingItemPickup; setOwnedItems((items) => { const next = [...(items[pickup.seatId] ?? [])]; next.splice(index, 1, pickup.item); return { ...items, [pickup.seatId]: next }; }); setBoardItems((items) => items.filter((item) => item.id !== pickup.itemId)); addLog(`아이템 '${ITEM_DEFINITIONS[type].name}'을 버리고 '${ITEM_DEFINITIONS[pickup.item].name}'을 획득했습니다.`); setPendingItemPickup(null); }}>{ITEM_DEFINITIONS[type].name} 버리기</button>)}<button className="secondary" onClick={() => { addLog(`새 아이템 '${ITEM_DEFINITIONS[pendingItemPickup.item].name}'을 획득하지 않았습니다.`); setPendingItemPickup(null); }}>획득 안 함</button></div></section></div>}

    {screen === 'game' && <section data-testid="game-screen" className="game-layout" aria-label="게임 플레이 화면">
      <aside data-testid="players-panel" className="panel players"><h2>{activeRoomTitle || title}</h2><p className="game-end-guide">개인전은 내 말 모두, 팀전은 팀 말 모두 완주하면 승리!</p>{playableSeats.map((seat) => { const orderIndex = turnOrderIds.indexOf(seat.id); return <div className={`player ${seat.isAI ? 'ai' : ''} ${activeSeat?.id === seat.id ? 'active' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}><b style={{ color: playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat) }}>{seat.label}</b><span>{seat.label}-{seat.name}</span><div className="player-badges">{orderIndex >= 0 && <small className="turn-order-badge">{orderIndex + 1}번째</small>}{playMode === 'team' && <small>{seat.team}</small>}</div><em>{seat.isAI ? 'AI 플레이' : activeSeat?.id === seat.id ? '현재 턴' : '대기'}</em>{!seat.isHost && !seat.isAI && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>나감 처리</button>}</div>; })}{spectators.length > 0 && <div className="spectator-list"><h2>관전자</h2>{spectators.map((spectator) => <p key={spectator.id}>👁 {spectator.name}</p>)}</div>}<div className="player-items"><h2>보유 아이템</h2>{(ownedItems[localSeatId] ?? []).length ? <div className="item-grid">{(ownedItems[localSeatId] ?? []).map((type, index) => <button className="item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><ItemCard type={type} /></button>)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</div><button className="secondary end-game" onClick={() => { if (window.confirm('정말로 게임을 나가시겠어요?')) finishGame(); }}>게임 종료</button></aside>
      <section className="panel board-panel">{winner && <div className="winner-overlay" role="status" aria-live="assertive"><span>게임 종료</span><strong>{winner}</strong><p>{winner}했습니다. 아래 버튼으로 대기화면에 돌아갈 수 있습니다.</p><button onClick={finishGame}>대기화면으로</button></div>}{turnOrderIntro?.visible && <div className="turn-order-ready-overlay" role="status" aria-live="assertive"><span>랜덤 차례 순서</span><strong className="turn-order-final-list">{(turnOrderIntro.order ?? []).map((entry, index) => <span className="turn-order-final-card" style={{ color: entry.color, borderColor: entry.color }} key={entry.seatId}>{index + 1}. {entry.label}-{entry.name}</span>)}</strong></div>}{turnOrderIntro && !turnOrderIntro.visible && <div className="turn-order-lock" role="status" aria-live="polite">잠시 후 게임 시작!</div>}{goldenYutPickerOpen && <div className="golden-yut-picker" role="dialog" aria-modal="true" aria-label="황금 윷 결과 선택"><h2>황금 윷 결과 선택</h2><p>원하는 결과를 고르면 다음 윷 던지기가 반드시 그 결과로 나옵니다.</p><div>{GOLDEN_YUT_CHOICES.map((choice) => <button key={choice.name} onClick={() => { setForcedRoll(choice); setGoldenYutPickerOpen(false); showToast('황금 윷 설정 완료', `${choice.name} 결과가 예약되었습니다.`, '✨'); }}>{choice.name}</button>)}</div></div>}<div data-testid="turn-indicator" className="turn-indicator" style={{ color: activeSeat ? (playMode === 'team' ? TEAM_COLORS[activeSeat.team] : getSeatPieceColor(activeSeat)) : undefined }}>{winner ? `${winner} · 게임 종료` : activeSeat ? `${activeSeat.label}-${activeSeat.name} 턴` : '턴 대기'}</div>{(turnToast || toast) && <div className="board-message-stack" aria-live="polite">{turnToast && <div className="turn-toast board-toast" key={turnToast.id} role="status">{turnToast.text}</div>}{toast && <div className="toast-message board-toast" role="status"><strong>{toast.icon} {toast.title}</strong>{toast.description && <span>{toast.description}</span>}</div>}</div>}<GameBoard pieces={pieces} items={boardItems} selectedPieceId={selectedPieceId} selectedPieceIds={selectedGroupPieceIds} movingPieceId={movingPieceId} onSelectPiece={(pieceId) => { const targetPiece = pieces.find((piece) => piece.id === pieceId); if (canUseMoveButton && targetPiece && activeSeat && !canSeatControlPiece(activeSeat, targetPiece)) return; setSelectedPieceId(pieceId); }} revealedItems={revealedItems} highlightedNodeId={highlightedNodeId} trapNodeIds={trapNodes.map((trap) => trap.nodeId)} previewNodeIds={previewNodeIds} branchChoice={branchChoice} onBranchChoiceChange={setBranchChoice} showBranchControls={false} capturedPieceIds={Array.from(new Set([...(captureEffect?.pieceIds ?? []), ...(trapEffect?.pieceIds ?? [])]))} trapEffectNodeId={trapEffect?.nodeId} selectableNodeIds={trapPlacementNodeIds} onSelectNode={placePendingTrap} boardShaking={Boolean(captureEffect)} isPieceSelectable={(piece) => !(canUseMoveButton && activeSeat && !canSeatControlPiece(activeSeat, piece))} />{rollAnimation && <div className="roll-stage" role="status" aria-live="polite"><div className="roll-aura" aria-hidden="true"></div><div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${rollAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div><div className={`roll-mat ${rollAnimation.result.bonus && !rollAnimation.turnOrder ? 'bonus-roll' : ''}`}><span className="roll-label">{rollAnimation.result.name}</span>{rollAnimation.result.bonus && !rollAnimation.turnOrder && <strong className="roll-callout">한 번 더!</strong>}{rollAnimation.sticks.map((stick, index) => <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${stick.flat ? 'flat' : 'round'} ${stick.marked ? 'marked' : ''}`} style={{ '--stick-index': index, '--stick-start-rotate': `${-360 + index * 45}deg`, '--stick-land-rotate': `${28 - index * 14}deg`, '--stick-bounce-rotate': `${12 + index * 18}deg`, '--stick-final-rotate': `${-8 + index * 12}deg` } as CSSProperties}><i></i></span>)}</div></div>}{pendingTrapPlacement && <div className="trap-placement-banner" role="status"><strong>함정 설치 위치를 선택하세요</strong><span>{Math.max(0, Math.ceil((pendingTrapPlacement.deadline - trapPlacementClock) / 1000))}초 남음 · 설치 중에는 윷을 던질 수 없습니다.</span></div>}<div className={`play-controls ${!roll ? 'roll-ready' : ''} ${showBottomBranchControls ? 'branch-choice-mode' : ''} ${activeItemPromptTypes.length ? 'item-prompt-mode' : ''}`}>{activeItemPromptTypes.length > 0 ? <div className="inline-item-prompt" role="dialog" aria-label="아이템 사용 선택"><div><strong>아이템을 사용할까요?</strong><span>10초 안에 선택하지 않으면 사용하지 않고 진행합니다.</span></div><div className="item-prompt-timer" aria-hidden="true"><span></span></div><div className="inline-item-actions">{activeItemPromptTypes.map((type, index) => <button className="inline-item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}<button className="secondary" onClick={() => setItemPromptTiming(null)}>사용 안 함</button></div></div> : showBottomBranchControls ? <div className="bottom-branch-controls" aria-label="이동 방향 선택"><button type="button" className={branchChoice === 'outer' ? 'active' : ''} onClick={() => setBranchChoice('outer')}>바깥길</button><button type="button" className={branchChoice === 'shortcut' ? 'active' : ''} onClick={() => setBranchChoice('shortcut')}>지름길</button><button type="button" className="branch-move-button" onClick={() => moveSelectedPiece()} disabled={!canRequestMove}>선택한 말 이동</button></div> : <button data-testid={roll ? 'move-piece-button' : canSubmitTurnAction ? 'roll-yut-button' : 'turn-waiting-button'} className={!roll ? 'roll-button' : undefined} onClick={() => roll ? moveSelectedPiece() : rollYut()} disabled={(!canRollNow && !roll) || Boolean(roll && !canRequestMove)}>{roll ? (rollResultHolding ? '결과 확인 중...' : '선택한 말 이동') : activeSeat && activeSeat.id !== localSeatId ? `${activeSeat.label} - ${activeSeat.name} 차례` : pendingTrapPlacement ? '함정 설치 대기 중' : turnOrderIntro ? '결과 확인 중' : '윷 던지기'}</button>}</div></section>
      <aside className="panel side"><h2>진행 기록</h2><div className="log-list">{logs.map((log) => <p key={log.id}>{renderLogText(log.text)}</p>)}</div></aside>
    </section>}
  </main>;
}
