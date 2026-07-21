import type { PieceCount, PlayMode } from '../appState';

export type WaitingRoomOptions = {
  playMode: PlayMode;
  maxPlayers: 2 | 3 | 4;
  itemMode: boolean;
  stackedRollMode: boolean;
  pieceCount: PieceCount;
};

export type WaitingRoomOptionPatch = Partial<WaitingRoomOptions>;

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
