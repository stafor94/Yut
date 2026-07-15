export type GamePresentationTurnInput = {
  activeSeatId?: string;
  localSeatId: string;
  presentationActorId?: string;
};

export type GamePresentationTurn = {
  activeSeatId: string;
  isMyTurn: boolean;
  isFrozen: boolean;
};

export function getGamePresentationTurn({
  activeSeatId = '',
  localSeatId,
  presentationActorId = '',
}: GamePresentationTurnInput): GamePresentationTurn {
  const normalizedActorId = presentationActorId.trim();
  const displayedActiveSeatId = normalizedActorId || activeSeatId;
  return {
    activeSeatId: displayedActiveSeatId,
    isMyTurn: Boolean(displayedActiveSeatId && displayedActiveSeatId === localSeatId),
    isFrozen: Boolean(normalizedActorId),
  };
}
