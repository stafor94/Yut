import type { BoardPiece } from '../features/game/components/GameBoard';
import type { ItemTiming, ItemType } from '../features/items/logic/items';
import type { BoardItem, BranchChoice } from '../game-core/board/board';
import type { RollTimingZone, YutResult, YutStick } from '../game-core/roll';
import type { GameSeatSnapshot, RoomPlayer } from '../features/room/services/roomService';

export type Screen = 'lobby' | 'waitingRoom' | 'game';
export type PlayMode = 'individual' | 'team';
export type Team = '청팀' | '홍팀';
export type PieceCount = 1 | 2 | 3 | 4;

export type Seat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost?: boolean;
  isAI?: boolean;
  isEmpty?: boolean;
  isSpectator?: boolean;
  enteredGameAt?: number;
  enteredStartVersion?: number;
  team: Team;
};

export type GameLog = { id: number; text: string };
export type ToastMessage = { id: number; title: string; description?: string; icon?: string };
export type RollAnimation = { id: number; result: YutResult; sticks: YutStick[]; turnOrder?: boolean; fallCount?: number; timingZone?: RollTimingZone };
export type TurnOrderRoll = { seat: Seat; result: YutResult; rollOffRound: number };
export type TurnOrderPhase = { active: boolean; index: number; rolls: TurnOrderRoll[]; deadline: number; readyAt: number };
export type TurnOrderIntro = { order: { seatId: string; label: string; name: string; color: string }[]; visible: boolean; readyAt: number; slotUntil?: number };
export type CaptureEffect = { id: number; pieceIds: string[] };
export type TrapEffect = { id: number; nodeId: string; pieceIds: string[] };
export type FallEffect = { id: number; seatId: string; timingZone?: RollTimingZone };
export type PendingTrapPlacement = { ownerId: string; pieceId: string; nodeIds: string[]; deadline: number };
export type PendingItemPickup = { seatId: string; item: ItemType; itemId: string; existingItem: ItemType; deadline: number };
export type TrapNode = { nodeId: string; ownerId: string };
export type StalledTurnSyncResolution =
  | { status: 'not-stalled'; reason: string; ageMs: number }
  | { status: 'waiting'; reason: string; ageMs: number; recoveryAfterMs: number }
  | { status: 'recoverable'; reason: string; ageMs: number; recoveryKey: string; pieceId: string }
  | { status: 'blocked'; reason: string; ageMs: number; recoveryKey?: string; pieceId?: string };
export type ManualSyncResolution = StalledTurnSyncResolution & {
  createdAt: number;
  localSequence: number;
  latestSequence: number;
  result: string;
};
export type SequenceStateSnapshot = Partial<{
  pieces: BoardPiece[];
  turnIndex: number;
  turnOrderIds: string[];
  initialTurnOrderIds: string[];
  completedSeatIds: string[];
  rankingSeatIds: string[];
  gameEndMode: 'partial_finish' | 'final' | '';
  lastFinishedSeatId: string;
  continuationRound: number;
  roll: YutResult | null;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  boardItems: BoardItem[];
  ownedItems: Record<string, ItemType[]>;
  trapNodes: TrapNode[];
  shieldedPieceIds: string[];
  logs: GameLog[];
  winner: string;
  captureEffect: CaptureEffect | null;
  trapEffect: TrapEffect | null;
  fallEffect: FallEffect | null;
  lastRollTimingZone?: RollTimingZone | null;
  gameStartedAt: number | null;
  turnOrderIntro: TurnOrderIntro | null;
  pendingTrapPlacement: PendingTrapPlacement | null;
  rollLockUntil: number;
  lastMovedPieceIds: string[];
  lastMovedSeatId: string;
  itemPromptTiming: ItemTiming | null;
  branchChoice: BranchChoice;
  rollResultReadyAt: number;
  turnOrderPhase: TurnOrderPhase | null;
  waitingForPlayersReady: boolean;
  turnDeadlineAt: number;
  turnDeadlineKind: 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
  gameSeats: GameSeatSnapshot[];
  startRequestVersion: number;
  turnVersion: number;
  lastSequence: number;
}>;

export type GameStateFingerprintInput = {
  pieces: BoardPiece[];
  turnIndex: number;
  turnOrderIds: string[];
  initialTurnOrderIds: string[];
  completedSeatIds: string[];
  rankingSeatIds: string[];
  gameEndMode: 'partial_finish' | 'final' | '';
  lastFinishedSeatId: string;
  continuationRound: number;
  roll: YutResult | null;
  rollStack: YutResult[];
  selectedRollStackIndex: number | null;
  rollStackClosed: boolean;
  boardItems: BoardItem[];
  ownedItems: Record<string, ItemType[]>;
  trapNodes: TrapNode[];
  shieldedPieceIds: string[];
  winner: string;
  gameStartedAt: number | null;
  turnOrderIntro: TurnOrderIntro | null;
  pendingTrapPlacement: PendingTrapPlacement | null;
  rollLockUntil: number;
  lastMovedPieceIds: string[];
  lastMovedSeatId: string;
  effectiveRollResultReadyAt: number;
  turnOrderPhase: TurnOrderPhase | null;
  waitingForPlayersReady: boolean;
  turnDeadlineAt?: number;
  turnDeadlineKind?: 'roll' | 'move' | 'turn_order' | 'item_prompt' | 'trap_placement' | '';
  startRequestVersion: number;
  fallEffect?: FallEffect | null;
  lastRollTimingZone?: RollTimingZone | null;
  logs?: GameLog[];
  gameSeats?: GameSeatSnapshot[];
};

export const makeGameStateFingerprint = (state: GameStateFingerprintInput) => JSON.stringify({
  pieces: state.pieces,
  turnIndex: state.turnIndex,
  turnOrderIds: state.turnOrderIds,
  initialTurnOrderIds: state.initialTurnOrderIds,
  completedSeatIds: state.completedSeatIds,
  rankingSeatIds: state.rankingSeatIds,
  gameEndMode: state.gameEndMode,
  lastFinishedSeatId: state.lastFinishedSeatId,
  continuationRound: state.continuationRound,
  roll: state.roll,
  rollStack: state.rollStack,
  selectedRollStackIndex: state.selectedRollStackIndex,
  rollStackClosed: state.rollStackClosed,
  boardItems: state.boardItems,
  ownedItems: state.ownedItems,
  trapNodes: state.trapNodes,
  shieldedPieceIds: state.shieldedPieceIds,
  winner: state.winner,
  gameStartedAt: state.gameStartedAt,
  turnOrderIntro: state.turnOrderIntro,
  pendingTrapPlacement: state.pendingTrapPlacement,
  rollLockUntil: state.rollLockUntil,
  lastMovedPieceIds: state.lastMovedPieceIds,
  lastMovedSeatId: state.lastMovedSeatId,
  effectiveRollResultReadyAt: state.effectiveRollResultReadyAt,
  turnOrderPhase: state.turnOrderPhase,
  waitingForPlayersReady: state.waitingForPlayersReady,
  turnDeadlineAt: state.turnDeadlineAt ?? 0,
  turnDeadlineKind: state.turnDeadlineKind ?? '',
  startRequestVersion: state.startRequestVersion,
  fallEffect: state.fallEffect ?? null,
  lastRollTimingZone: state.lastRollTimingZone ?? null,
  logs: state.logs ?? [],
  gameSeats: state.gameSeats ?? [],
});

export const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
export const PLAYER_COLOR_LABELS = ['빨강', '파랑', '초록', '노랑'];
export const TEAM_COLORS: Record<Team, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
export const ROOM_COLOR_LABELS: Record<string, string> = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };
export const STORAGE_KEYS = { nickname: 'yut-online:nickname', title: 'yut-online:title', playMode: 'yut-online:playMode', maxPlayers: 'yut-online:maxPlayers', itemMode: 'yut-online:itemMode', stackedRollMode: 'yut-online:stackedRollMode', pieceCount: 'yut-online:pieceCount', soundEnabled: 'yut-online:soundEnabled', activeRoomId: 'yut-online:activeRoomId', isRoomHost: 'yut-online:isRoomHost' } as const;
export const NICKNAME_MAX_LENGTH = 7;
export const normalizeNickname = (value: string) => value.trim().slice(0, NICKNAME_MAX_LENGTH);
export const getStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === 'true';
};
export const getStoredNumber = <T extends number>(key: string, fallback: T, allowed: readonly T[]) => {
  if (typeof window === 'undefined') return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return allowed.includes(stored as T) ? stored as T : fallback;
};
export const getStoredPlayMode = () => {
  const stored = getStoredText(STORAGE_KEYS.playMode, 'individual');
  return stored === 'team' ? 'team' : 'individual';
};
export const getStoredText = (key: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) || fallback;
};
export const AI_NAME_PREFIXES = ['씩씩한', '재빠른', '느긋한', '영리한', '용감한', '유쾌한', '차분한', '반짝이는', '든든한', '행운의'];
export const AI_NAME_BASES = ['단풍이', '구름이', '호랑이', '두루미', '반달이', '별님이', '솔방울', '바람이', '나무꾼', '달토끼', '해님이', '복주머니'];
export const RANDOM_NICKNAME_PREFIXES = ['민첩한', '행운의', '반짝이는', '용감한', '느긋한', '쾌활한', '든든한', '재빠른'];
export const RANDOM_NICKNAME_BASES = ['토끼', '호랑이', '두루미', '다람쥐', '구름', '단풍', '별님', '솔방울'];
export const makeRandomNickname = () => `${RANDOM_NICKNAME_PREFIXES[Math.floor(Math.random() * RANDOM_NICKNAME_PREFIXES.length)]} ${RANDOM_NICKNAME_BASES[Math.floor(Math.random() * RANDOM_NICKNAME_BASES.length)]}${Math.floor(Math.random() * 90) + 10}`;
export const getInitialNickname = () => normalizeNickname(getStoredText(STORAGE_KEYS.nickname, '') || makeRandomNickname());

export const createSeats = (hostName: string, playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
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


export const seatsFromRoomPlayers = (players: RoomPlayer[], playMode: PlayMode, playerCount: 2 | 3 | 4, hostId = ''): Seat[] => {
  const defaults = createSeats('', playMode, playerCount);
  const activePlayers = players.filter((player) => !player.isSpectator);
  return defaults.map((seat, index) => {
    const player = activePlayers.find((candidate) => candidate.seatIndex === index);
    if (!player) return hostId ? { ...seat, isHost: false } : seat;
    return {
      ...seat,
      id: player.id,
      name: player.nickname,
      color: ROOM_COLOR_LABELS[player.color] ?? player.color,
      ready: player.ready,
      isHost: hostId ? player.id === hostId : index === 0,
      isAI: player.isAI,
      isEmpty: false,
      enteredGameAt: player.enteredGameAt,
      enteredStartVersion: player.enteredStartVersion,
      team: player.team,
    };
  });
};


export const seatsWithJoinedPlayer = (players: RoomPlayer[], currentUserId: string, nickname: string, playMode: PlayMode, playerCount: 2 | 3 | 4, joinedSeatIndex: number | null = null): Seat[] => {
  const seats = seatsFromRoomPlayers(players, playMode, playerCount);
  if (players.some((player) => player.id === currentUserId)) return seats;
  const targetSeat = joinedSeatIndex === null ? seats.find((seat) => seat.isEmpty) : seats[joinedSeatIndex];
  if (!targetSeat) return seats;
  return seats.map((seat) => seat.id === targetSeat.id ? { ...seat, id: currentUserId, name: nickname, ready: false, isEmpty: false } : seat);
};

export const spectatorsFromRoomPlayers = (players: RoomPlayer[]): Seat[] => players
  .filter((player) => player.isSpectator)
  .map((player) => ({ id: player.id, label: '관전', name: player.nickname, color: '관전', ready: true, isSpectator: true, team: '청팀' as Team }));

export const gameSeatSnapshotsFromSeats = (sourceSeats: Seat[]): GameSeatSnapshot[] => sourceSeats
  .filter((seat) => !seat.isEmpty && !seat.isSpectator)
  .map((seat) => ({
    id: seat.id,
    label: seat.label,
    name: seat.name,
    color: seat.color,
    team: seat.team,
    isHost: seat.isHost,
    isAI: seat.isAI,
    seatIndex: Number(seat.label.replace('P', '')) - 1,
  }));

export const seatsFromGameSeatSnapshots = (gameSeats: GameSeatSnapshot[], playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
  const defaults = createSeats('', playMode, playerCount).map((seat) => ({ ...seat, isHost: false }));
  return defaults.map((seat, index) => {
    const gameSeat = gameSeats.find((candidate) => Number(candidate.seatIndex) === index || candidate.label === seat.label);
    if (!gameSeat) return seat;
    return {
      ...seat,
      id: gameSeat.id,
      label: gameSeat.label,
      name: gameSeat.name,
      color: gameSeat.color,
      ready: true,
      isHost: gameSeat.isHost,
      isAI: gameSeat.isAI,
      isEmpty: false,
      team: gameSeat.team,
    };
  });
};

export const preserveLockedGameSeats = (currentSeats: Seat[], nextSeats: Seat[]) => nextSeats.map((nextSeat) => {
  const currentSeat = currentSeats.find((seat) => seat.label === nextSeat.label);
  if (!currentSeat || currentSeat.isEmpty || currentSeat.isSpectator) return nextSeat;
  if (!nextSeat.isEmpty && nextSeat.id === currentSeat.id) return { ...currentSeat, ...nextSeat, isEmpty: false };
  if (!nextSeat.isEmpty && nextSeat.isAI && nextSeat.id === currentSeat.id) return { ...currentSeat, ...nextSeat, id: currentSeat.id, isEmpty: false };
  return { ...currentSeat, ready: nextSeat.ready || currentSeat.ready, isEmpty: false };
});

export const makePieces = (seats: Seat[], pieceCount: PieceCount, mode: PlayMode = 'individual'): BoardPiece[] => {
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
