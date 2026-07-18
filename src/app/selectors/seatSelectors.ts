import type { PlayMode, Seat, Team } from '../appTypes';
import { PLAYER_COLOR_LABELS, ROOM_COLOR_LABELS } from '../constants/playerPresentation';
import { getActivePlayerSeats, getSeatIndexFromLabel } from './gameViewSelectors';

type RoomPlayerSeatSource = {
  id: string;
  nickname: string;
  ready: boolean;
  color: string;
  seatIndex: number;
  team: Team;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  isSpectator?: boolean;
  enteredGameAt?: number;
  enteredStartVersion?: number;
};

type GameSeatSnapshotShape = {
  id: string;
  label: string;
  name: string;
  color: string;
  team: Team;
  isHost?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  seatIndex: number;
};

export const createSeats = (
  hostName: string,
  playMode: PlayMode,
  playerCount: 2 | 3 | 4,
): Seat[] => {
  const defaultTeams: Team[] = playMode === 'team'
    ? ['청팀', '홍팀', '청팀', '홍팀']
    : ['청팀', '청팀', '청팀', '청팀'];

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

export const seatsFromRoomPlayers = (
  players: RoomPlayerSeatSource[],
  playMode: PlayMode,
  playerCount: 2 | 3 | 4,
  hostId = '',
): Seat[] => {
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
      isSubstitutedByAI: player.isSubstitutedByAI,
      isEmpty: false,
      enteredGameAt: player.enteredGameAt,
      enteredStartVersion: player.enteredStartVersion,
      team: player.team,
    };
  });
};

export const seatsWithJoinedPlayer = (
  players: RoomPlayerSeatSource[],
  currentUserId: string,
  nickname: string,
  playMode: PlayMode,
  playerCount: 2 | 3 | 4,
  joinedSeatIndex: number | null = null,
): Seat[] => {
  const seats = seatsFromRoomPlayers(players, playMode, playerCount);
  if (players.some((player) => player.id === currentUserId)) return seats;

  const targetSeat = joinedSeatIndex === null
    ? seats.find((seat) => seat.isEmpty)
    : seats[joinedSeatIndex];
  if (!targetSeat) return seats;

  return seats.map((seat) => seat.id === targetSeat.id
    ? { ...seat, id: currentUserId, name: nickname, ready: false, isEmpty: false }
    : seat);
};

export const spectatorsFromRoomPlayers = (players: RoomPlayerSeatSource[]): Seat[] => players
  .filter((player) => player.isSpectator)
  .map((player) => ({
    id: player.id,
    label: '관전',
    name: player.nickname,
    color: '관전',
    ready: true,
    isSpectator: true,
    team: '청팀',
  }));

export const gameSeatSnapshotsFromSeats = (sourceSeats: Seat[]): GameSeatSnapshotShape[] =>
  getActivePlayerSeats(sourceSeats).map((seat) => ({
    id: seat.id,
    label: seat.label,
    name: seat.name,
    color: seat.color,
    team: seat.team,
    isHost: seat.isHost,
    isAI: seat.isAI,
    isSubstitutedByAI: seat.isSubstitutedByAI,
    seatIndex: getSeatIndexFromLabel(seat.label),
  }));

export const seatsFromGameSeatSnapshots = (
  gameSeats: GameSeatSnapshotShape[],
  playMode: PlayMode,
  playerCount: 2 | 3 | 4,
): Seat[] => {
  const defaults = createSeats('', playMode, playerCount).map((seat) => ({ ...seat, isHost: false }));

  return defaults.map((seat, index) => {
    const gameSeat = gameSeats.find((candidate) =>
      Number(candidate.seatIndex) === index || candidate.label === seat.label);
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
      isSubstitutedByAI: gameSeat.isSubstitutedByAI,
      isEmpty: false,
      team: gameSeat.team,
    };
  });
};

export const preserveLockedGameSeats = (
  currentSeats: Seat[],
  nextSeats: Seat[],
): Seat[] => nextSeats.map((nextSeat) => {
  const currentSeat = currentSeats.find((seat) => seat.label === nextSeat.label);
  if (!currentSeat || currentSeat.isEmpty || currentSeat.isSpectator) return nextSeat;
  if (!nextSeat.isEmpty && nextSeat.id === currentSeat.id) {
    return { ...currentSeat, ...nextSeat, isEmpty: false };
  }
  if (!nextSeat.isEmpty && nextSeat.isAI && nextSeat.id === currentSeat.id) {
    return { ...currentSeat, ...nextSeat, id: currentSeat.id, isEmpty: false };
  }
  return { ...currentSeat, ready: nextSeat.ready || currentSeat.ready, isEmpty: false };
});
