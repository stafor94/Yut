import { spawnInitialBoardItems } from '../../game-core/board/board';
import { ROOM_START_CANCEL_LOCK_MS } from '../../features/room/services/roomGamePreparationPolicy';
import { TURN_ACTION_TIMEOUT_MS } from '../../features/room/services/roomTiming';
import { buildAlternatingTeamTurnOrder, createTurnOrderIntro, formatTurnOrderSummary } from './turnOrderFlow';

export { ROOM_START_CANCEL_LOCK_MS };
const TURN_ORDER_FINAL_HOLD_MS = 3_000;
const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'] as const;
const TEAM_COLORS: Record<GameStartPreparationPlayer['team'], string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
const ROOM_COLOR_LABELS: Record<string, string> = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };

export type GameStartPreparationRoom = {
  id: string;
  hostId?: string;
  maxPlayers: number;
  itemMode: boolean;
  playMode: 'individual' | 'team';
  pieceCount: 1 | 2 | 3 | 4;
};

export type GameStartPreparationPlayer = {
  id: string;
  nickname: string;
  color: string;
  seatIndex: number;
  team: '청팀' | '홍팀';
  ready?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isSpectator?: boolean;
};

type PreparedSeat = {
  id: string;
  label: string;
  name: string;
  color: string;
  ready: boolean;
  isHost: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  team: GameStartPreparationPlayer['team'];
  seatIndex: number;
};

const getStableTurnOrderScore = (seed: string, seatId: string) => {
  const value = `${seed}:${seatId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getSeededTurnOrderSeats = (targetSeats: PreparedSeat[], seed: string) => [...targetSeats].sort((left, right) => {
  const scoreDiff = getStableTurnOrderScore(seed, left.id) - getStableTurnOrderScore(seed, right.id);
  return scoreDiff || left.label.localeCompare(right.label, undefined, { numeric: true });
});

const getActiveRoomGamePlayers = (room: GameStartPreparationRoom, players: GameStartPreparationPlayer[]) => players
  .filter((player) => !player.isSpectator && Number.isInteger(Number(player.seatIndex)) && Number(player.seatIndex) >= 0 && Number(player.seatIndex) < room.maxPlayers);

export const isCompleteRoomGamePlayerSnapshot = (room: GameStartPreparationRoom, players: GameStartPreparationPlayer[]) => {
  const expectedSeatCount = Number(room.maxPlayers);
  if (![2, 3, 4].includes(expectedSeatCount)) return false;

  const activePlayers = getActiveRoomGamePlayers(room, players);
  if (activePlayers.length !== expectedSeatCount) return false;

  const playerIds = new Set<string>();
  const seatIndexes = new Set<number>();
  for (const player of activePlayers) {
    const playerId = player.id.trim();
    const seatIndex = Number(player.seatIndex);
    if (!playerId || playerIds.has(playerId) || seatIndexes.has(seatIndex)) return false;
    if (!player.isAI && !player.isSubstitutedByAI && player.ready !== true) return false;
    playerIds.add(playerId);
    seatIndexes.add(seatIndex);
  }
  if (!Array.from({ length: expectedSeatCount }, (_, index) => index).every((index) => seatIndexes.has(index))) return false;

  if (room.playMode === 'team') {
    if (expectedSeatCount !== 4) return false;
    const teamCounts = activePlayers.reduce<Record<GameStartPreparationPlayer['team'], number>>(
      (counts, player) => ({ ...counts, [player.team]: counts[player.team] + 1 }),
      { 청팀: 0, 홍팀: 0 },
    );
    if (teamCounts.청팀 !== 2 || teamCounts.홍팀 !== 2) return false;
  }

  return true;
};

const getPreparedSeats = (room: GameStartPreparationRoom, players: GameStartPreparationPlayer[]): PreparedSeat[] => getActiveRoomGamePlayers(room, players)
  .sort((left, right) => Number(left.seatIndex) - Number(right.seatIndex))
  .map((player) => ({
    id: player.id,
    label: `P${Number(player.seatIndex) + 1}`,
    name: player.nickname,
    color: ROOM_COLOR_LABELS[player.color] ?? player.color,
    ready: true,
    isHost: player.id === room.hostId,
    isAI: player.isAI,
    isSubstitutedByAI: player.isSubstitutedByAI,
    team: player.team,
    seatIndex: Number(player.seatIndex),
  }));

const makePreparedPieces = (seats: PreparedSeat[], pieceCount: GameStartPreparationRoom['pieceCount'], playMode: GameStartPreparationRoom['playMode']) => {
  if (playMode === 'team') {
    return (['청팀', '홍팀'] as GameStartPreparationPlayer['team'][]).flatMap((team) => {
      const teamSeats = seats.filter((seat) => seat.team === team);
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

  return seats.flatMap((seat) => Array.from({ length: pieceCount }, (_, pieceIndex) => ({
    id: `${seat.id}-piece-${pieceIndex + 1}`,
    ownerId: seat.id,
    label: `${seat.label}-${pieceIndex + 1}`,
    color: PLAYER_COLORS[seat.seatIndex] ?? '#2a1e17',
    nodeIndex: 0,
    nodeId: 'n01',
    started: false,
    finished: false,
  })));
};

export const getRoomStartRequestKey = (roomId: string, startRequestVersion: number, startRequestId: string) => (
  roomId && startRequestVersion && startRequestId ? `${roomId}:${startRequestVersion}:${startRequestId}` : ''
);

export const getRoomStartPreparationAt = (countdownEndsAt: number) => Math.max(0, countdownEndsAt - ROOM_START_CANCEL_LOCK_MS);

export const getRoomStartPreparationMutationId = (roomId: string, startRequestVersion: number, startRequestId: string) => (
  `game_initialized:${roomId}:${startRequestVersion}:${startRequestId}`
);

export const getGameStartCoordinatorPlayerId = (players: GameStartPreparationPlayer[]) => [...players]
  .filter((player) => !player.isSpectator && !player.isAI)
  .sort((left, right) => Number(left.seatIndex) - Number(right.seatIndex))[0]?.id ?? '';

export function buildPreparedRoomGameState(params: {
  roomId: string;
  room: GameStartPreparationRoom;
  players: GameStartPreparationPlayer[];
  startRequestVersion: number;
  startRequestId: string;
  countdownEndsAt: number;
}) {
  const { roomId, room, players, startRequestVersion, startRequestId, countdownEndsAt } = params;
  const seats = getPreparedSeats(room, players);
  const seededSeats = getSeededTurnOrderSeats(seats, `${roomId}:${startRequestVersion}`);
  const orderedSeats = room.playMode === 'team'
    ? buildAlternatingTeamTurnOrder(seededSeats.map((seat) => ({ seat, result: { name: '도' as const, steps: 1, bonus: false }, rollOffRound: 1 })))
    : seededSeats;
  const turnOrderIds = orderedSeats.map((seat) => seat.id);
  const { intro: turnOrderIntro } = createTurnOrderIntro(orderedSeats, {
    getSeatPieceColor: (seat) => PLAYER_COLORS[seat.seatIndex] ?? '#2a1e17',
    playMode: room.playMode,
    finalHoldMs: TURN_ORDER_FINAL_HOLD_MS,
    now: countdownEndsAt,
  });
  const gameStartedAt = turnOrderIntro.readyAt;
  const gameSeats = seats.map((seat) => ({
    id: seat.id,
    label: seat.label,
    name: seat.name,
    color: seat.color,
    team: seat.team,
    isHost: seat.isHost,
    isAI: seat.isAI,
    isSubstitutedByAI: seat.isSubstitutedByAI,
    seatIndex: seat.seatIndex,
  }));

  return {
    pieces: makePreparedPieces(seats, room.pieceCount, room.playMode),
    turnIndex: 0,
    turnOrderIds,
    initialTurnOrderIds: turnOrderIds,
    completedSeatIds: [] as string[],
    rankingSeatIds: [] as string[],
    gameEndMode: '' as const,
    lastFinishedSeatId: '',
    continuationRound: 0,
    roll: null,
    rollStack: [] as unknown[],
    selectedRollStackIndex: null,
    rollStackClosed: false,
    boardItems: room.itemMode ? spawnInitialBoardItems(4, 8) : [],
    ownedItems: {} as Record<string, unknown[]>,
    trapNodes: [] as unknown[],
    shieldedPieceIds: [] as string[],
    logs: [{ id: 1, text: formatTurnOrderSummary(orderedSeats, (seat) => seat.name || seat.label) }],
    winner: '',
    captureEffect: null,
    trapEffect: null,
    fallEffect: null,
    pendingGoldenYutSelection: null,
    gameStartedAt,
    turnOrderIntro,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    pendingAfterMoveTurnIndex: undefined,
    rollLockUntil: 0,
    lastMovedPieceIds: [] as string[],
    lastMovedSeatId: '',
    itemPromptTiming: null,
    branchChoice: 'outer' as const,
    rollResultReadyAt: 0,
    turnOrderPhase: { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 },
    waitingForPlayersReady: false,
    turnActionTimeoutCountBySeatId: {} as Record<string, number>,
    turnDeadlineAt: gameStartedAt + TURN_ACTION_TIMEOUT_MS,
    turnDeadlineKind: 'roll' as const,
    startRequestVersion,
    startRequestId,
    startCountdownEndsAt: countdownEndsAt,
    gameSeats,
  };
}
