import type { Seat } from '../appTypes';

export const selectPlayableSeats = (seats: Seat[]) => seats.filter((seat) => !seat.isEmpty && !seat.isSpectator);
export const selectHostSeat = (seats: Seat[]) => seats.find((seat) => seat.isHost && !seat.isEmpty && !seat.isSpectator) ?? null;
