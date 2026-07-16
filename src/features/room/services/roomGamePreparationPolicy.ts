export const ROOM_START_CANCEL_LOCK_MS = 2_000;
export const ROOM_START_ACTIVATION_LEAD_MS = 750;
export const ROOM_START_ACTIVATION_GRACE_MS = 5_000;

export const isRoomGamePreparationWindowOpen = (countdownEndsAt: number, now = Date.now()) => (
  countdownEndsAt > 0
  && now >= countdownEndsAt - ROOM_START_CANCEL_LOCK_MS
  && now < countdownEndsAt
);

export const isRoomGameActivationWindowOpen = (countdownEndsAt: number, now = Date.now()) => (
  countdownEndsAt > 0
  && now >= countdownEndsAt - ROOM_START_ACTIVATION_LEAD_MS
  && now <= countdownEndsAt + ROOM_START_ACTIVATION_GRACE_MS
);

export const hasCompletePreparedGameSeats = (gameSeats: unknown, maxPlayers: unknown) => {
  const expectedSeatCount = Number(maxPlayers);
  if (![2, 3, 4].includes(expectedSeatCount) || !Array.isArray(gameSeats) || gameSeats.length !== expectedSeatCount) return false;

  const seatIds = new Set<string>();
  const seatIndexes = new Set<number>();
  for (const rawSeat of gameSeats) {
    if (!rawSeat || typeof rawSeat !== 'object') return false;
    const seat = rawSeat as { id?: unknown; seatIndex?: unknown };
    const seatId = typeof seat.id === 'string' ? seat.id.trim() : '';
    const seatIndex = Number(seat.seatIndex);
    if (!seatId || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= expectedSeatCount) return false;
    if (seatIds.has(seatId) || seatIndexes.has(seatIndex)) return false;
    seatIds.add(seatId);
    seatIndexes.add(seatIndex);
  }

  return Array.from({ length: expectedSeatCount }, (_, index) => index).every((index) => seatIndexes.has(index));
};
