export type LobbyRoomActionText = '준비 중' | '참가' | '관전';

export function getLobbyRoomActionText(params: {
  firebaseConfigured: boolean;
  currentUserId: string;
  roomInGame: boolean;
  playerIds?: string[];
}): LobbyRoomActionText {
  if (params.firebaseConfigured && !params.currentUserId) return '준비 중';
  if (!params.roomInGame) return '참가';
  return params.playerIds?.includes(params.currentUserId) ? '참가' : '관전';
}
