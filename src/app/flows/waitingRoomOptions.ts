import type { PieceCount, PlayMode, Seat, Team } from '../appTypes';

export type WaitingRoomOptions = {
  playMode: PlayMode;
  maxPlayers: 2 | 3 | 4;
  itemMode: boolean;
  stackedRollMode: boolean;
  pieceCount: PieceCount;
};

export type WaitingRoomOptionPatch = Partial<WaitingRoomOptions>;

const getDefaultSeatTeam = (index: number, playMode: PlayMode): Team => (
  playMode === 'team' && index % 2 === 1 ? '홍팀' : '청팀'
);

export function normalizeWaitingRoomSeatTeams(seats: Seat[], playMode: PlayMode): Seat[] {
  let changed = false;
  const normalized = seats.map((seat, index) => {
    const team = getDefaultSeatTeam(index, playMode);
    if (seat.team === team) return seat;
    changed = true;
    return { ...seat, team };
  });
  return changed ? normalized : seats;
}

export function resolveWaitingRoomOptions(current: WaitingRoomOptions, requested: WaitingRoomOptionPatch): WaitingRoomOptions {
  const playMode = requested.playMode ?? current.playMode;
  return {
    playMode,
    maxPlayers: playMode === 'team' ? 4 : requested.maxPlayers ?? current.maxPlayers,
    itemMode: requested.itemMode ?? current.itemMode,
    stackedRollMode: requested.stackedRollMode ?? current.stackedRollMode,
    pieceCount: requested.pieceCount ?? (requested.playMode === 'team' && current.playMode !== 'team' ? 2 : current.pieceCount),
  };
}

export function getChangedWaitingRoomOptions(current: WaitingRoomOptions, next: WaitingRoomOptions): WaitingRoomOptionPatch {
  return {
    ...(current.playMode !== next.playMode ? { playMode: next.playMode } : {}),
    ...(current.maxPlayers !== next.maxPlayers ? { maxPlayers: next.maxPlayers } : {}),
    ...(current.itemMode !== next.itemMode ? { itemMode: next.itemMode } : {}),
    ...(current.stackedRollMode !== next.stackedRollMode ? { stackedRollMode: next.stackedRollMode } : {}),
    ...(current.pieceCount !== next.pieceCount ? { pieceCount: next.pieceCount } : {}),
  };
}
