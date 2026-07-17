export type PresenceGameSeat = {
  id?: unknown;
  seatIndex?: unknown;
  isAI?: unknown;
  isSubstitutedByAI?: unknown;
  presenceEpoch?: unknown;
  [key: string]: unknown;
};

export type GameSeatControlState = {
  playerId: string;
  seatIndex: number;
  isAI: boolean;
  isSubstitutedByAI: boolean;
  presenceEpoch: number;
};

export function updateGameSeatControlState(
  gameSeats: unknown,
  control: GameSeatControlState,
): PresenceGameSeat[] | null {
  if (!Array.isArray(gameSeats)) return null;
  let changed = false;
  const nextSeats = gameSeats.map((value) => {
    if (!value || typeof value !== 'object') return value as PresenceGameSeat;
    const seat = value as PresenceGameSeat;
    const seatIndex = Number(seat.seatIndex);
    const matchesPlayer = typeof seat.id === 'string' && seat.id === control.playerId;
    const matchesSeatIndex = Number.isInteger(seatIndex) && seatIndex === control.seatIndex;
    if (!matchesPlayer && !matchesSeatIndex) return seat;
    const nextSeat = {
      ...seat,
      isAI: control.isAI,
      isSubstitutedByAI: control.isSubstitutedByAI,
      presenceEpoch: control.presenceEpoch,
    };
    if (
      seat.isAI !== nextSeat.isAI
      || seat.isSubstitutedByAI !== nextSeat.isSubstitutedByAI
      || Number(seat.presenceEpoch ?? 0) !== control.presenceEpoch
    ) changed = true;
    return nextSeat;
  });
  return changed ? nextSeats : null;
}
