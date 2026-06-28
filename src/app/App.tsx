import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { User } from 'firebase/auth';
import { GameBoard, type BoardPiece } from '../features/game/components/GameBoard';
import { ItemCard } from '../features/items/components/ItemCard';
import type { ItemTiming, ItemType } from '../features/items/logic/items';
import { ITEM_DEFINITIONS } from '../features/items/logic/items';
import { BOARD_NODES, BRANCH_NODE_IDS, getBoardNodeById, getMovePathNodeIds, spawnInitialBoardItems, type BoardItem, type BranchChoice } from '../game-core/board/board';
import { GOLDEN_YUT_CHOICES, makeDisplaySticks, rollYutResult, type YutResult, type YutStick } from '../game-core/roll';
import { createRoom, deleteRoom, joinRoom, removeRoomPlayer, saveGameState, subscribeGameState, subscribeRoom, subscribeRoomPlayers, updateRoomOptions, updateRoomPlayer, updateRoomStatus, type RoomPlayer, type RoomSummary } from '../features/room/services/roomService';
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
  team: Team;
};

type GameLog = { id: number; text: string };
type ToastMessage = { id: number; title: string; description?: string; icon?: string };
type RollAnimation = { id: number; result: YutResult; sticks: YutStick[] };
type TurnOrderRoll = { seat: Seat; result: YutResult; rollOffRound: number };
type CaptureEffect = { id: number; pieceIds: string[] };
type TrapNode = { nodeId: string; ownerId: string };

const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
const TEAM_COLORS: Record<Team, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
const ROOM_COLOR_LABELS: Record<string, string> = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };
const STORAGE_KEYS = { nickname: 'yut-online:nickname', title: 'yut-online:title', playMode: 'yut-online:playMode', maxPlayers: 'yut-online:maxPlayers', itemMode: 'yut-online:itemMode', pieceCount: 'yut-online:pieceCount', soundEnabled: 'yut-online:soundEnabled' } as const;
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
const AI_MOVE_DELAY_MS = 2000;
const AUTO_SINGLE_MOVE_DELAY_MS = 2000;
const CREATE_ROOM_TIMEOUT_MS = 12000;
const STEP_DELAY_MS = 240;
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
    color: ['빨강', '파랑', '초록', '노랑'][index] ?? '검정',
    ready: index === 0,
    isHost: index === 0,
    isEmpty: index !== 0,
    team: defaultTeams[index] ?? '청팀',
  }));
};


const seatsFromRoomPlayers = (players: RoomPlayer[], playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
  const defaults = createSeats('', playMode, playerCount);
  return defaults.map((seat, index) => {
    const player = players.find((candidate) => candidate.seatIndex === index);
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
      color: PLAYER_COLORS[index] ?? '#2a1e17',
      nodeIndex: 0,
      nodeId: 'n01',
      started: false,
      finished: false,
    })),
  );
};

const getMovePreviewNodeIds = (piece: BoardPiece | undefined, result: YutResult | null, branchChoice: BranchChoice) => {
  if (!piece || !result || piece.finished) return [];
  if (result.steps < 0 && !piece.started) return [];
  return getMovePathNodeIds(piece.nodeId, result.steps, branchChoice);
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
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
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const [captureEffect, setCaptureEffect] = useState<CaptureEffect | null>(null);
  const [forcedRoll, setForcedRoll] = useState<YutResult | null>(null);
  const [goldenYutPickerOpen, setGoldenYutPickerOpen] = useState(false);
  const [itemPromptTiming, setItemPromptTiming] = useState<ItemTiming | null>(null);
  const lastWinnerSoundRef = useRef('');
  const activeRoomIdRef = useRef('');
  const rooms = useRooms();
  const serverStatus = isFirebaseConfigured ? (user ? '온라인' : '입장 준비 중') : '연결 정보 확인 필요';
  const serverStatusTone = isFirebaseConfigured ? (user ? 'online' : 'pending') : 'offline';
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
  const localSeatId = activeRoomId && user ? user.uid : hostSeatId;
  const isMyTurn = activeSeat?.id === localSeatId && !activeSeat.isAI;
  const getSeatById = (seatId: string) => playableSeats.find((seat) => seat.id === seatId);
  const isSameSide = (a: Seat | undefined, b: Seat | undefined) => Boolean(a && b && (playMode === 'team' ? a.team === b.team : a.id === b.id));
  const canSeatControlPiece = (seat: Seat | undefined, piece: BoardPiece | undefined) => Boolean(seat && piece && isSameSide(getSeatById(piece.ownerId), seat));
  const selectedPiece = useMemo(() => pieces.find((piece) => piece.id === selectedPieceId), [pieces, selectedPieceId]);
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
  const canMoveSelectedPiece = Boolean(roll && activeSeat && isMyTurn && canSeatControlPiece(activeSeat, selectedPiece) && !selectedPiece?.finished && (selectedMoveSteps >= 0 || selectedPiece?.started));
  const canUseMoveButton = Boolean(roll && activeSeat && isMyTurn && !winner && !movingPieceId && canMoveSelectedPiece);
  const showBottomBranchControls = Boolean(canUseMoveButton && selectedPiece?.started && BRANCH_NODE_IDS.includes(selectedPiece.nodeId as typeof BRANCH_NODE_IDS[number]));
  const activeItemPromptTypes = itemPromptTiming ? getUsableHostItems(itemPromptTiming) : [];

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    const unsubscribe = listenAuthState(setUser);
    signInAsGuest().catch((error) => setMessage(error.message));
    return unsubscribe;
  }, []);


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
        setMessage('방이 종료되어 대기실로 이동했습니다.');
        return;
      }
      setActiveRoomTitle(room.title);
      setPlayMode(room.playMode);
      setMaxPlayers(room.maxPlayers as 2 | 3 | 4);
      setItemMode(room.itemMode);
      setPieceCount(room.pieceCount ?? 4);
      if (room.status === 'playing') setScreen('game');
      if (room.status === 'finished') {
        setScreen('lobby');
        setActiveRoomId('');
        setActiveRoomTitle('');
        setIsRoomHost(false);
        setCountdown(-1);
        setItemPromptTiming(null);
        setMessage('게임이 종료되어 첫 대기화면으로 돌아왔습니다.');
      }
    });
  }, [activeRoomId]);


  useEffect(() => {
    if (!activeRoomId) return undefined;
    return subscribeRoomPlayers(activeRoomId, (players) => {
      setSeats(seatsFromRoomPlayers(players, playMode, maxPlayers));
    });
  }, [activeRoomId, maxPlayers, playMode]);

  useEffect(() => {
    if (!activeRoomId || isRoomHost) return undefined;
    return subscribeGameState(activeRoomId, (state) => {
      if (!state) return;
      setPieces(state.pieces as BoardPiece[]);
      setTurnIndex(state.turnIndex);
      setRoll(state.roll as YutResult | null);
      setBoardItems(state.boardItems);
      setOwnedItems(state.ownedItems as Record<string, ItemType[]>);
      setTrapNodes(state.trapNodes as TrapNode[]);
      setShieldedPieceIds(state.shieldedPieceIds);
      setLogs(state.logs as GameLog[]);
      setCaptureEffect((state.captureEffect as CaptureEffect | null | undefined) ?? null);
      setGameStartedAt((state.gameStartedAt as number | null | undefined) ?? null);
      setTurnOrderIds((state.turnOrderIds as string[] | undefined) ?? []);
    });
  }, [activeRoomId, isRoomHost]);

  useEffect(() => {
    if (!activeRoomId || !isRoomHost || screen !== 'game') return;
    void saveGameState(activeRoomId, { pieces, turnIndex, turnOrderIds, roll, boardItems, ownedItems, trapNodes, shieldedPieceIds, logs, winner, captureEffect, gameStartedAt });
  }, [activeRoomId, boardItems, captureEffect, gameStartedAt, isRoomHost, logs, ownedItems, pieces, roll, screen, shieldedPieceIds, trapNodes, turnIndex, turnOrderIds, winner]);

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
    const timer = window.setInterval(() => setPlayTimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [gameStartedAt, screen]);

  useEffect(() => {
    if (screen === 'game' && roll && isMyTurn && !movingPieceId) showItemPrompt('after_roll');
  }, [roll]);

  useEffect(() => {
    if (screen === 'game' && lastMovedSeatId === localSeatId && !movingPieceId) showItemPrompt('after_move');
  }, [lastMovedPieceIds, lastMovedSeatId, localSeatId]);


  useEffect(() => {
    if (screen !== 'game' || !activeSeat || winner) { setTurnToast(null); return undefined; }
    const nextTurnToast = { id: Date.now(), text: `${activeSeat.label}-${activeSeat.name} 차례` };
    setTurnToast(nextTurnToast);
    const timer = window.setTimeout(() => setTurnToast((current) => current?.id === nextTurnToast.id ? null : current), 3000);
    return () => window.clearTimeout(timer);
  }, [activeSeat?.id, activeSeat?.label, activeSeat?.name, screen, turnIndex, winner]);

  useEffect(() => {
    if (screen !== 'game' || winner || itemPromptTiming || !activeSeat || isMyTurn || roll || movingPieceId) return undefined;
    const timer = window.setTimeout(() => { void autoPlayTurn(activeSeat); }, TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeSeat, isMyTurn, itemPromptTiming, movingPieceId, pieces, roll, screen, winner]);


  useEffect(() => {
    if (!roll || !activeSeat || !isMyTurn || movingPieceId || winner) return;
    const steps = roll.steps;
    const movablePieces = pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (steps >= 0 || piece.started));
    if (movablePieces.length === 0) {
      const timer = window.setTimeout(() => {
        addLog(steps < 0 ? `${activeSeat.label}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.` : `${activeSeat.label}은(는) 이동할 말이 없습니다.`);
        setBranchChoice('outer');
        setRoll(null);
        setTurnIndex((current) => (current + 1) % playableSeats.length);
      }, TURN_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    if (movablePieces.length !== 1 && movablePieces.some((piece) => piece.started)) return;
    const onlyPiece = movablePieces[0];
    const needsBranchChoice = onlyPiece.started && BRANCH_NODE_IDS.includes(onlyPiece.nodeId as typeof BRANCH_NODE_IDS[number]);
    if (needsBranchChoice) return;
    setSelectedPieceId(onlyPiece.id);
    const timer = window.setTimeout(() => { void movePiece(onlyPiece.id, roll, activeSeat); }, AUTO_SINGLE_MOVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeSeat, isMyTurn, movingPieceId, pieces, playableSeats.length, roll, winner]);

  useEffect(() => {
    if (screen !== 'waitingRoom' || countdown < 0) return undefined;
    if (!allReady) { setCountdown(-1); setMessage('준비가 해제되어 게임 시작이 취소되었습니다.'); return undefined; }
    if (countdown === 0) { startLocalGame(); return undefined; }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [allReady, countdown, screen]);

  async function handleCreateRoom() {
    if (!user) { setMessage('입장 준비가 끝난 뒤 다시 시도하세요.'); return; }
    if (!nickname.trim()) { setMessage('닉네임을 먼저 정해주세요.'); return; }
    if (isCreatingRoom) return;
    setIsCreatingRoom(true);
    setMessage('방을 만드는 중입니다. 잠시만 기다려주세요...');
    try {
      const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('방 만들기 시간이 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.')), CREATE_ROOM_TIMEOUT_MS));
      const roomId = await Promise.race([createRoom({ title, hostId: user.uid, nickname, maxPlayers, itemMode, playMode, pieceCount }), timeout]);
      await openWaitingRoom({ id: roomId, title, itemMode, maxPlayers, playMode, pieceCount }, '', true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '방 생성에 실패했습니다. 잠시 뒤 다시 시도해주세요.');
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function openWaitingRoom(room: Pick<RoomSummary, 'title' | 'itemMode' | 'maxPlayers' | 'playMode' | 'pieceCount'> & { id?: string }, nextMessage = '', asHost = false) {
    setMessage('방으로 이동하는 중입니다...');
    setActiveRoomId(room.id ?? '');
    setIsRoomHost(asHost);
    setActiveRoomTitle(room.title);
    setPlayMode(room.playMode);
    setMaxPlayers(room.maxPlayers as 2 | 3 | 4);
    setItemMode(room.itemMode);
    setPieceCount(room.pieceCount ?? 4);
    if (!asHost && room.id && user) {
      await joinRoom(room.id, { userId: user.uid, nickname, playMode: room.playMode });
    }
    const nextSeats = createSeats(nickname, room.playMode, room.maxPlayers as 2 | 3 | 4);
    setSeats(nextSeats);
    setScreen('waitingRoom');
    setMessage(nextMessage);
  }

  function handleStartGame() {
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

  function decideTurnOrder() {
    const rankedRolls = resolveTurnOrderRolls(playableSeats);
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
    const rollSummary = rankedRolls.map((entry) => `${entry.seat.label} ${entry.result.name}${entry.rollOffRound > 1 ? `(${entry.rollOffRound}차)` : ''}`).join(' · ');
    addLog(`순서 정하기: ${rollSummary}`);
    addLog(`차례 순서: ${turnOrder.map((seat) => `${seat.label}-${seat.name}`).join(' → ')}`);
    setTurnOrderIds(turnOrder.map((seat) => seat.id));
    return turnOrder;
  }

  function startLocalGame() {
    if (activeRoomId && isRoomHost) { void updateRoomStatus(activeRoomId, 'playing'); }
    const orderedSeats = decideTurnOrder();
    const nextPieces = makePieces(orderedSeats, pieceCount, playMode);
    setPieces(nextPieces);
    setBoardItems(itemMode ? spawnInitialBoardItems(4, 8) : []);
    setOwnedItems({}); setTrapNodes([]); setShieldedPieceIds([]); setLastMovedPieceIds([]); setLastMovedSeatId(''); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); setRoll(null); setForcedRoll(null); setGoldenYutPickerOpen(false); setItemPromptTiming(null); setBranchChoice('outer'); setCaptureEffect(null);
    setGameStartedAt(Date.now());
    setLogs([{ id: Date.now(), text: '게임이 시작되었습니다. 시작 순서를 정했습니다.' }]);
    setScreen('game');
  }

  function playSfx(effect: SoundEffect) { playSoundEffect(effect, soundEnabled); }
  function addLog(text: string) { setLogs((current) => [{ id: Date.now(), text }, ...current]); }
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
      if (type === 'shield') return lastMovedPieceIds.some((id) => pieces.some((piece) => piece.id === id && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished));
      if (type === 'trap') return pieces.some((piece) => piece.id === selectedPieceId && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished);
      return true;
    });
  }
  function showItemPrompt(timing: ItemTiming) {
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
        void updateRoomPlayer(activeRoomId, playerId, { nickname: aiName, ready: true, isAI: true, seatIndex: Number(targetSeat.label.replace('P', '')) - 1, color: ['red', 'blue', 'green', 'yellow'][Number(targetSeat.label.replace('P', '')) - 1] ?? 'black', team: targetSeat.team });
      }
      return currentSeats.map((seat) => seat.id === playerId ? { ...seat, name: aiName, ready: true, isAI: true, isEmpty: false } : seat);
    });
  }
  function cancelAISeat(playerId: string) {
    if (activeRoomId) { void removeRoomPlayer(activeRoomId, playerId); }
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId && seat.isAI ? { ...seat, name: '빈 자리', ready: false, isAI: false, isEmpty: true } : seat));
  }
  function changeTeam(playerId: string, team: Team) {
    if (activeRoomId) { void updateRoomPlayer(activeRoomId, playerId, { team }); }
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === playerId ? { ...seat, team } : seat));
  }
  function rollYutFor(seat: Seat) {
    const rolled = forcedRoll ? { result: forcedRoll, sticks: makeDisplaySticks(forcedRoll) } : rollYutResult();
    const nextRoll = rolled.result;
    setForcedRoll(null);
    setRoll(nextRoll);
    setRollAnimation({ id: Date.now(), result: nextRoll, sticks: rolled.sticks });
    playSfx('roll');
    if (nextRoll.bonus) window.setTimeout(() => playSfx('bonus'), 420);
    window.setTimeout(() => setRollAnimation(null), 2600);
    addLog(`${seat.label}이(가) ${nextRoll.name}(${nextRoll.steps}칸)를 던졌습니다.`);
    return nextRoll;
  }
  function rollYut() { if (!activeSeat || !isMyTurn || movingPieceId) return; setShieldedPieceIds([]); rollYutFor(activeSeat); }

  async function movePiece(pieceId: string, result: YutResult, seat: Seat, extraSteps = 0, branchOverride: BranchChoice = branchChoice) {
    if (winner || movingPieceId) return false;
    const movingPiece = pieces.find((piece) => piece.id === pieceId && canSeatControlPiece(seat, piece) && !piece.finished);
    if (!movingPiece) { setTurnIndex((current) => (current + 1) % playableSeats.length); setRoll(null); return false; }
    const steps = result.steps + extraSteps;
    if (steps < 0 && !movingPiece.started) {
      addLog(`${seat.label}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
      setBranchChoice('outer');
      setRoll(null);
      setTurnIndex((current) => (current + 1) % playableSeats.length);
      return false;
    }
    if (steps === 0) {
      addLog(`${seat.label} 말은 이동할 칸 수가 없어 제자리에 머뭅니다.`);
      setBranchChoice('outer');
      setRoll(null);
      setTurnIndex((current) => (current + 1) % playableSeats.length);
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
    const movePathNodeIds = getMovePathNodeIds(currentNodeId, steps, branchOverride);
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
      setOwnedItems((items) => ({ ...items, [seat.id]: [...(items[seat.id] ?? []), landedItem.type] }));
      setRevealedItems((items) => Array.from(new Set([...items, landedItem.type])));
      setBoardItems((items) => items.filter((item) => item.id !== landedItem.id));
      const itemName = ITEM_DEFINITIONS[landedItem.type].name;
      addLog(`${seat.label}이(가) 아이템 '${itemName}'을 획득했습니다.`);
      showToast(itemName, ITEM_DEFINITIONS[landedItem.type].description, ITEM_DEFINITIONS[landedItem.type].icon);
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
        addLog(`${seat.label} 말이 방패로 함정을 막았습니다.`);
        playSfx('shield');
      } else {
        setPieces((currentPieces) => currentPieces.map((piece) => movingGroupIds.includes(piece.id) ? { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false } : piece));
        addLog(`${seat.label} 말이 함정을 밟아 시작점으로 돌아갑니다.`);
        playSfx('trap');
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
        addLog(`${seat.label}이(가) 상대 말을 잡아 한 번 더 던집니다.`);
      }
    }
    if (finishedMove) { addLog(`${seat.label} 말이 완주했습니다!`); playSfx('arrive'); }
    const controlledPiecesDone = pieces.filter((piece) => canSeatControlPiece(seat, piece) && piece.id !== pieceId).every((piece) => piece.finished) && finishedMove;
    if (controlledPiecesDone) addLog(`${playMode === 'team' ? seat.team : seat.label}의 모든 말이 완주했습니다.`);
    if (result.bonus && captured) addLog(`${result.name}와 잡기 보너스로 한 번 더 던질 수 있습니다.`);
    else if (result.bonus) addLog(`${result.name}가 나와 한 번 더 던질 수 있습니다.`);
    else if (captured) addLog('상대 말을 잡아 한 번 더 던질 수 있습니다.');
    else setTurnIndex((current) => (current + 1) % playableSeats.length);
    setLastMovedPieceIds(movingGroupIds);
    setLastMovedSeatId(seat.id);
    setBranchChoice('outer');
    setMovingPieceId('');
    setRoll(null);
    return true;
  }

  function moveSelectedPiece(extraSteps = 0) {
    if (!roll || !activeSeat || !isMyTurn) return false;
    const steps = roll.steps + extraSteps;
    const canMovePiece = (piece: BoardPiece) => steps >= 0 || piece.started;
    const selectedPiece = pieces.find((piece) => piece.id === selectedPieceId && canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece));
    const fallbackPiece = pieces.find((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && canMovePiece(piece));
    if (!selectedPiece && fallbackPiece) setSelectedPieceId(fallbackPiece.id);
    if (!selectedPiece && !fallbackPiece) {
      if (steps < 0) {
        addLog(`${activeSeat.label}은(는) 판 위에 나온 말이 없어 빽도를 이동하지 못합니다.`);
        setBranchChoice('outer');
        setRoll(null);
        setTurnIndex((current) => (current + 1) % playableSeats.length);
      }
      return false;
    }
    void movePiece((selectedPiece ?? fallbackPiece)?.id ?? selectedPieceId, roll, activeSeat, extraSteps);
    return true;
  }

  function getAiBranchChoice(piece: BoardPiece): BranchChoice {
    return piece.started && BRANCH_NODE_IDS.includes(piece.nodeId as typeof BRANCH_NODE_IDS[number]) ? 'shortcut' : 'outer';
  }

  function scoreAiMove(piece: BoardPiece, result: YutResult, seat: Seat, aiBranchChoice: BranchChoice) {
    const steps = result.steps;
    if (steps < 0 && !piece.started) return Number.NEGATIVE_INFINITY;
    const pathNodeIds = getMovePathNodeIds(piece.nodeId, steps, aiBranchChoice);
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

  async function autoPlayTurn(seat: Seat) {
    const nextRoll = rollYutFor(seat);
    const aiMove = chooseAiMove(seat, nextRoll);
    if (!aiMove) { setTurnIndex((current) => (current + 1) % playableSeats.length); setRoll(null); return; }
    setBranchChoice(aiMove.branchChoice);
    await delay(AI_MOVE_DELAY_MS);
    await movePiece(aiMove.piece.id, nextRoll, seat, 0, aiMove.branchChoice);
  }

  function useItem(type: ItemType) {
    if (movingPieceId) return;
    const itemOwnerId = localSeatId;
    const itemOwnerSeat = playableSeats.find((seat) => seat.id === itemOwnerId);
    if (!itemOwnerSeat) return;
    const activeItems = ownedItems[itemOwnerId] ?? [];
    if (!activeItems.includes(type)) return;
    const consumeItem = () => { playSfx('itemUse'); setItemPromptTiming(null); setOwnedItems((items) => { const nextSeatItems = [...(items[itemOwnerId] ?? [])]; nextSeatItems.splice(nextSeatItems.indexOf(type), 1); return { ...items, [itemOwnerId]: nextSeatItems }; }); };
    if (type === 'golden_yut') {
      if (!isMyTurn || roll) { addLog('황금 윷은 내 턴에 윷을 던지기 전에 사용할 수 있습니다.'); return; }
      consumeItem();
      setGoldenYutPickerOpen(true);
      addLog('황금 윷을 사용했습니다. 다음 윷 결과를 선택하세요.');
      return;
    }
    if (type === 'reroll') {
      if (!isMyTurn || !roll) { addLog('다시 던지기는 내 턴에 윷을 던진 뒤 사용할 수 있습니다.'); return; }
      consumeItem();
      rollYutFor(itemOwnerSeat);
      return;
    }
    if (type === 'move_plus_one' || type === 'move_minus_one') {
      if (!isMyTurn || !roll) { addLog('이동 보정 아이템은 내 턴에 윷을 던진 뒤 사용할 수 있습니다.'); return; }
      if (!moveSelectedPiece(type === 'move_plus_one' ? 1 : -1)) return;
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
      const trapPiece = pieces.find((piece) => piece.id === selectedPieceId && canSeatControlPiece(itemOwnerSeat, piece) && piece.started && !piece.finished);
      if (!trapPiece) { addLog('함정은 말판 위에 있는 내 말을 선택한 뒤 설치할 수 있습니다.'); return; }
      if (lastMovedSeatId !== itemOwnerId) { addLog('함정은 내 말이 이동한 직후에 설치할 수 있습니다.'); return; }
      consumeItem();
      setTrapNodes((nodes) => [...nodes.filter((trap) => trap.nodeId !== trapPiece.nodeId), { nodeId: trapPiece.nodeId, ownerId: itemOwnerId }]);
      addLog(`${itemOwnerSeat.label}이(가) ${trapPiece.label} 위치에 함정을 설치했습니다.`);
    }
  }


  async function toggleMyReady() {
    if (isRoomHost) return;
    const mySeat = seats.find((seat) => seat.id === localSeatId && !seat.isEmpty && !seat.isAI);
    if (!mySeat) { setMessage('내 참가 정보를 찾는 중입니다. 잠시 뒤 다시 시도하세요.'); return; }
    const nextReady = !mySeat.ready;
    setSeats((currentSeats) => currentSeats.map((seat) => seat.id === mySeat.id ? { ...seat, ready: nextReady } : seat));
    if (activeRoomId) await updateRoomPlayer(activeRoomId, mySeat.id, { ready: nextReady });
    setMessage(nextReady ? '준비 완료했습니다. 방장이 시작할 때까지 기다려주세요.' : '준비를 취소했습니다.');
  }

  async function leaveRoom() {
    if (isRoomHost && activeRoomId) await deleteRoom(activeRoomId);
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
    const nextPieceCount = next.pieceCount ?? pieceCount;
    setPlayMode(nextPlayMode);
    setMaxPlayers(nextMaxPlayers);
    setItemMode(nextItemMode);
    setPieceCount(nextPieceCount);
    if (isRoomHost && activeRoomId) await updateRoomOptions(activeRoomId, { playMode: nextPlayMode, maxPlayers: nextMaxPlayers, itemMode: nextItemMode, pieceCount: nextPieceCount });
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

  return <main className={`shell ${screen === 'game' ? 'game-shell' : 'lobby-shell'}`}>
    <section className="hero panel">
      <div className="hero-copy"><h1 className="brand-title">YUT ONLINE</h1>{screen === 'game' && <div className="play-time" aria-label={`현재 게임 플레이 타임 ${playTimeText}`}>{playTimeText}</div>}</div>
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
          <label>방 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="방 제목" /></label>
          <button className="primary-cta" onClick={handleCreateRoom} disabled={isCreatingRoom}>{isCreatingRoom ? <span className="button-loading" aria-hidden="true"></span> : null}{isCreatingRoom ? '방 만드는 중...' : '방 만들기'}</button>
        </div>
        {message && <p className="notice lobby-notice">{message}</p>}
      </section>
      <section className="panel room-panel join-room-panel">
        <div className="lobby-panel-heading">
          <p className="section-kicker">방 참여</p>
          <h2>대기중 방</h2>
          <span>{rooms.length ? `${rooms.length}개의 방이 플레이어를 기다리고 있어요.` : '새 방을 만들거나 친구의 방을 기다려보세요.'}</span>
        </div>
        <div className="room-list lobby-room-list">{rooms.length ? rooms.map((room) => <article className="room-card lobby-room-card" key={room.id}><div><b>{room.title}</b><span>{room.playMode === 'team' ? '팀전' : '개인전'} · 말 {room.pieceCount ?? 4}개 · {room.itemMode ? '아이템 ON' : '아이템 OFF'} · {room.maxPlayers}인</span></div><button onClick={() => { void openWaitingRoom(room); }}>참여</button></article>) : <div className="empty-lobby-room"><strong>아직 열린 방이 없습니다</strong><span>왼쪽에서 방을 만들면 친구들이 바로 참여할 수 있어요.</span></div>}</div>
      </section>
    </section>}

    {screen === 'waitingRoom' && (() => {
      const myWaitingSeat = seats.find((seat) => seat.id === localSeatId && !seat.isEmpty && !seat.isAI);
      const readyMissingCount = seats.filter((seat) => seat.isEmpty || (!seat.ready && !seat.isAI)).length;
      const teamStartHint = playMode === 'team' && !teamBalanced ? `청팀 ${Math.max(0, 2 - teamCounts.청팀)}명, 홍팀 ${Math.max(0, 2 - teamCounts.홍팀)}명이 더 필요해요.` : '';
      const startStatusText = allReady ? '시작 가능' : teamStartHint || `${readyMissingCount}명이 더 준비해야 해요.`;
      const roomRuleText = `${playMode === 'team' ? '팀전' : '개인전'} · ${maxPlayers}인 · 말 ${pieceCount}개 · 아이템 ${itemMode ? 'ON' : 'OFF'}`;
      return <section className={`panel waiting-room compact-waiting-room ${isRoomHost ? 'host-view' : 'player-view'}`} aria-label="방 대기 화면">
        <header className="waiting-header">
          <div>
            <h2 className="room-title">{activeRoomTitle || title}</h2>
            <p className="room-subtitle">{isRoomHost ? '방장은 규칙·팀·AI를 관리하고 게임을 시작할 수 있어요.' : '일반 플레이어는 준비/준비취소와 방 나가기만 할 수 있어요.'}</p>
          </div>
          <div className={`start-status ${allReady ? 'ready' : 'blocked'}`} role="status">
            <strong>{startStatusText}</strong>
            <span>{roomRuleText}</span>
          </div>
        </header>

        <div className="waiting-main-grid">
          <section className="waiting-setup-card" aria-label="방 설정과 시작 조건">
            <div className="mode-summary compact-mode-summary"><span>{playMode === 'team' ? '팀전' : '개인전'}</span><span>{maxPlayers}인</span><span>말 {pieceCount}개</span><span>아이템 {itemMode ? 'ON' : 'OFF'}</span></div>
            {playMode === 'team' && <div className="team-checklist" aria-label="팀전 시작 조건"><strong>팀 균형</strong><span className={teamCounts.청팀 === 2 ? 'ok' : ''}>청팀 {teamCounts.청팀}/2</span><span className={teamCounts.홍팀 === 2 ? 'ok' : ''}>홍팀 {teamCounts.홍팀}/2</span></div>}
            {isRoomHost ? <div className="host-room-options compact-options"><fieldset className="radio-group"><legend>진행</legend>{(['individual', 'team'] as PlayMode[]).map((mode) => <label key={mode}><input type="radio" name="playMode" checked={playMode === mode} onChange={() => changeWaitingOptions({ playMode: mode })} />{mode === 'team' ? '팀전' : '개인전'}</label>)}</fieldset><fieldset className="radio-group"><legend>인원</legend>{([2, 3, 4] as const).map((count) => <label key={count} className={playMode === 'team' && count !== 4 ? 'disabled' : ''} title={playMode === 'team' && count !== 4 ? '팀전은 4인만 가능합니다.' : undefined}><input type="radio" name="maxPlayers" checked={maxPlayers === count} disabled={playMode === 'team' && count !== 4} onChange={() => changeWaitingOptions({ maxPlayers: count })} />{count}인</label>)}</fieldset><fieldset className="radio-group"><legend>말</legend>{([1, 2, 3, 4] as const).map((count) => <label key={count}><input type="radio" name="pieceCount" checked={pieceCount === count} onChange={() => changeWaitingOptions({ pieceCount: count })} />{count}개</label>)}</fieldset><fieldset className="radio-group item-mode-group"><legend>아이템</legend>{([true, false] as const).map((enabled) => <label key={String(enabled)}><input type="radio" name="itemMode" checked={itemMode === enabled} onChange={() => changeWaitingOptions({ itemMode: enabled })} />{enabled ? 'ON' : 'OFF'}</label>)}</fieldset></div> : <div className="permission-note"><strong>내 권한</strong><span>준비/준비취소 · 방 나가기</span><small>규칙 변경, 팀 변경, AI 배치, 시작은 방장만 할 수 있어요.</small></div>}
          </section>

          <section className="ready-list compact-ready-list" aria-label="플레이어 자리">
            {seats.map((seat) => <article className={`ready-card compact-ready-card ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''} ${seat.id === localSeatId ? 'me' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}>
              <div className="seat-topline"><b>{seat.label}</b><span>{seat.isHost ? '방장' : seat.id === localSeatId ? '나' : seat.isEmpty ? '대기' : '참가자'}</span></div>
              <div className="seat-name-row"><strong>{seat.name}</strong><em>{seat.isAI ? 'AI' : seat.isEmpty ? '빈 자리' : seat.ready ? '준비 완료' : '준비 중'}</em></div>
              {playMode === 'team' && <select value={seat.team} onChange={(e) => changeTeam(seat.id, e.target.value as Team)} disabled={!isRoomHost || !seat.isEmpty && seat.id === localSeatId && !isRoomHost} aria-label={`${seat.label} 팀 선택`}><option value="청팀">청팀</option><option value="홍팀">홍팀</option></select>}
              {seat.isEmpty && isRoomHost && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>AI 추가</button>}
              {seat.isAI && isRoomHost && !seat.isHost && <button className="mini-button secondary ai-cancel-button" onClick={() => cancelAISeat(seat.id)}>AI 제거</button>}
            </article>)}
          </section>
        </div>

        {countdown >= 0 && <div className="countdown-scrim" role="presentation"><div className="countdown-overlay" role="status"><span>게임 시작</span><strong>{countdown}</strong>{isRoomHost && <button className="secondary mini-button" onClick={() => { setCountdown(-1); setMessage('시작이 취소되었습니다.'); }}>취소</button>}</div></div>}
        {playMode === 'team' && !teamBalanced && <p className="notice warning inline-warning">팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.</p>}
        <footer className="waiting-actions role-actions">
          {isRoomHost ? <button onClick={handleStartGame} disabled={!allReady}>게임 시작</button> : <button onClick={() => { void toggleMyReady(); }} disabled={!myWaitingSeat}>{myWaitingSeat?.ready ? '준비 취소' : '준비 완료'}</button>}
          <button className="secondary" onClick={leaveRoom}>방 나가기</button>
        </footer>
      </section>;
    })()}




    {screen === 'game' && <section className="game-layout" aria-label="게임 플레이 화면">
      <aside className="panel players"><h2>{activeRoomTitle || title}</h2><p className="game-end-guide">개인전은 내 말 모두, 팀전은 팀 말 모두 완주하면 승리!</p>{playableSeats.map((seat) => <div className={`player ${seat.isAI ? 'ai' : ''} ${activeSeat?.id === seat.id ? 'active' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}><b style={{ color: PLAYER_COLORS[playableSeats.findIndex((player) => player.id === seat.id)] }}>{seat.label}</b><span>{playMode === 'team' ? `${seat.team} 말 ${pieceCount}개` : `${seat.color} 말 ${pieceCount}개`} · {seat.name}</span>{playMode === 'team' && <small>{seat.team}</small>}<em>{seat.isAI ? 'AI 플레이' : activeSeat?.id === seat.id ? '현재 턴' : '대기'}</em>{!seat.isHost && !seat.isAI && <button className="mini-button" onClick={() => markPlayerAsAI(seat.id)}>나감 처리</button>}</div>)}<div className="player-items"><h2>보유 아이템</h2>{(ownedItems[localSeatId] ?? []).length ? <div className="item-grid">{(ownedItems[localSeatId] ?? []).map((type, index) => <button className="item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><ItemCard type={type} /></button>)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</div><button className="secondary end-game" onClick={finishGame}>게임 종료</button></aside>
      <section className="panel board-panel">{winner && <div className="winner-overlay" role="status" aria-live="assertive"><span>게임 종료</span><strong>{winner}</strong><p>{winner}했습니다. 아래 버튼으로 대기화면에 돌아갈 수 있습니다.</p><button onClick={finishGame}>대기화면으로</button></div>}{goldenYutPickerOpen && <div className="golden-yut-picker" role="dialog" aria-modal="true" aria-label="황금 윷 결과 선택"><h2>황금 윷 결과 선택</h2><p>원하는 결과를 고르면 다음 윷 던지기가 반드시 그 결과로 나옵니다.</p><div>{GOLDEN_YUT_CHOICES.map((choice) => <button key={choice.name} onClick={() => { setForcedRoll(choice); setGoldenYutPickerOpen(false); showToast('황금 윷 설정 완료', `${choice.name} 결과가 예약되었습니다.`, '✨'); }}>{choice.name}</button>)}</div></div>}<div className="turn-indicator" style={{ color: activeSeat ? PLAYER_COLORS[playableSeats.findIndex((player) => player.id === activeSeat.id)] : undefined }}>{winner ? `${winner} · 게임 종료` : activeSeat ? `${activeSeat.label}-${activeSeat.name} 턴` : '턴 대기'}</div>{(turnToast || toast) && <div className="board-message-stack" aria-live="polite">{turnToast && <div className="turn-toast board-toast" key={turnToast.id} role="status">{turnToast.text}</div>}{toast && <div className="toast-message board-toast" role="status"><strong>{toast.icon} {toast.title}</strong>{toast.description && <span>{toast.description}</span>}</div>}</div>}<GameBoard pieces={pieces} items={boardItems} selectedPieceId={selectedPieceId} movingPieceId={movingPieceId} onSelectPiece={(pieceId) => { const targetPiece = pieces.find((piece) => piece.id === pieceId); if (canUseMoveButton && targetPiece && activeSeat && !canSeatControlPiece(activeSeat, targetPiece)) return; setSelectedPieceId(pieceId); }} revealedItems={revealedItems} highlightedNodeId={highlightedNodeId} trapNodeIds={trapNodes.map((trap) => trap.nodeId)} previewNodeIds={previewNodeIds} branchChoice={branchChoice} onBranchChoiceChange={setBranchChoice} showBranchControls={false} capturedPieceIds={captureEffect?.pieceIds ?? []} boardShaking={Boolean(captureEffect)} isPieceSelectable={(piece) => !(canUseMoveButton && activeSeat && !canSeatControlPiece(activeSeat, piece))} />{rollAnimation && <div className="roll-stage" role="status" aria-live="polite"><div className="roll-aura" aria-hidden="true"></div><div className="roll-impact-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span key={`spark-${rollAnimation.id}-${index}`} style={{ '--spark-index': index } as CSSProperties}></span>)}</div><div className={`roll-mat ${rollAnimation.result.bonus ? 'bonus-roll' : ''}`}><span className="roll-label">{rollAnimation.result.name}</span>{rollAnimation.result.bonus && <strong className="roll-callout">{rollAnimation.result.name}! 한 번 더!</strong>}{rollAnimation.sticks.map((stick, index) => <span key={`${rollAnimation.id}-${index}`} className={`yut-stick ${stick.flat ? 'flat' : 'round'} ${stick.marked ? 'marked' : ''}`} style={{ '--stick-index': index, '--stick-start-rotate': `${-360 + index * 45}deg`, '--stick-land-rotate': `${28 - index * 14}deg`, '--stick-bounce-rotate': `${12 + index * 18}deg`, '--stick-final-rotate': `${-8 + index * 12}deg` } as CSSProperties}><i></i></span>)}</div></div>}<div className={`play-controls ${!roll ? 'roll-ready' : ''} ${showBottomBranchControls ? 'branch-choice-mode' : ''} ${activeItemPromptTypes.length ? 'item-prompt-mode' : ''}`}>{activeItemPromptTypes.length > 0 ? <div className="inline-item-prompt" role="dialog" aria-label="아이템 사용 선택"><div><strong>아이템을 사용할까요?</strong><span>10초 안에 선택하지 않으면 사용하지 않고 진행합니다.</span></div><div className="item-prompt-timer" aria-hidden="true"><span></span></div><div className="inline-item-actions">{activeItemPromptTypes.map((type, index) => <button className="inline-item-button" key={`${type}-${index}`} onClick={() => useItem(type)}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}<button className="secondary" onClick={() => setItemPromptTiming(null)}>사용 안 함</button></div></div> : showBottomBranchControls ? <div className="bottom-branch-controls" aria-label="이동 방향 선택"><button type="button" className={branchChoice === 'outer' ? 'active' : ''} onClick={() => setBranchChoice('outer')}>바깥길</button><button type="button" className={branchChoice === 'shortcut' ? 'active' : ''} onClick={() => setBranchChoice('shortcut')}>지름길</button><button type="button" className="branch-move-button" onClick={() => moveSelectedPiece()} disabled={!canMoveSelectedPiece}>선택한 말 이동</button></div> : <button className={!roll ? 'roll-button' : undefined} onClick={() => roll ? moveSelectedPiece() : rollYut()} disabled={!isMyTurn || Boolean(winner) || Boolean(movingPieceId) || Boolean(roll && !canMoveSelectedPiece)}>{roll ? '선택한 말 이동' : '윷 던지기'}</button>}</div></section>
      <aside className="panel side"><h2>진행 기록</h2><div className="log-list">{logs.map((log) => <p key={log.id}>{log.text}</p>)}</div></aside>
    </section>}
  </main>;
}
