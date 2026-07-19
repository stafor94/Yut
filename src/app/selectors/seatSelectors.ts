import type { PieceCount, PlayMode, Seat, Team } from '../appTypes';

type BoardPiece = {
  id: string;
  ownerId: string;
  label: string;
  color: string;
  nodeIndex: number;
  nodeId: string;
  started: boolean;
  finished: boolean;
};

type RoomPlayerSeatInput = {
  id: string;
  nickname: string;
  color: string;
  ready: boolean;
  seatIndex: number;
  isSpectator?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  enteredGameAt?: number;
  enteredStartVersion?: number;
  team: Team;
};

type GameSeatSnapshotInput = {
  id: string;
  label: string;
  name: string;
  color: string;
  team: Team;
  isHost?: boolean;
  isAI?: boolean;
  isSubstitutedByAI?: boolean;
  seatIndex?: number;
};

type GameSeatSnapshotOutput = Omit<GameSeatSnapshotInput, 'seatIndex'> & { seatIndex: number };

export const PLAYER_COLORS = ['#d94a38', '#3a78c2', '#2f9e6f', '#d6a11d'];
export const PLAYER_COLOR_LABELS = ['빨강', '파랑', '초록', '노랑'];
export const TEAM_COLORS: Record<Team, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
export const ROOM_COLOR_LABELS: Record<string, string> = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑' };

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

export const seatsFromRoomPlayers = (players: readonly RoomPlayerSeatInput[], playMode: PlayMode, playerCount: 2 | 3 | 4, hostId = ''): Seat[] => {
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

export const seatsWithJoinedPlayer = (players: readonly RoomPlayerSeatInput[], currentUserId: string, nickname: string, playMode: PlayMode, playerCount: 2 | 3 | 4, joinedSeatIndex: number | null = null): Seat[] => {
  const seats = seatsFromRoomPlayers(players, playMode, playerCount);
  if (players.some((player) => player.id === currentUserId)) return seats;
  const targetSeat = joinedSeatIndex === null ? seats.find((seat) => seat.isEmpty) : seats[joinedSeatIndex];
  if (!targetSeat) return seats;
  return seats.map((seat) => seat.id === targetSeat.id ? { ...seat, id: currentUserId, name: nickname, ready: false, isEmpty: false } : seat);
};

export const spectatorsFromRoomPlayers = (players: readonly RoomPlayerSeatInput[]): Seat[] => players
  .filter((player) => player.isSpectator)
  .map((player) => ({ id: player.id, label: '관전', name: player.nickname, color: '관전', ready: true, isSpectator: true, team: '청팀' as Team }));

export const gameSeatSnapshotsFromSeats = (sourceSeats: Seat[]): GameSeatSnapshotOutput[] => sourceSeats
  .filter((seat) => !seat.isEmpty && !seat.isSpectator)
  .map((seat) => ({
    id: seat.id,
    label: seat.label,
    name: seat.name,
    color: seat.color,
    team: seat.team,
    isHost: seat.isHost,
    isAI: seat.isAI,
    isSubstitutedByAI: seat.isSubstitutedByAI,
    seatIndex: Number(seat.label.replace('P', '')) - 1,
  }));

export const seatsFromGameSeatSnapshots = (gameSeats: readonly GameSeatSnapshotInput[], playMode: PlayMode, playerCount: 2 | 3 | 4): Seat[] => {
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
      isSubstitutedByAI: gameSeat.isSubstitutedByAI,
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

  return activeSeats.flatMap((seat) =>
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
