import type { Seat } from '../appTypes';

export const getOccupiedSeats = (seats: Seat[]) => seats.filter((seat) => !seat.isEmpty);

export const getActivePlayerSeats = (seats: Seat[]) =>
  seats.filter((seat) => !seat.isEmpty && !seat.isSpectator);

export const getSeatIndexFromLabel = (label: string) => Number(label.replace('P', '')) - 1;

export const findSeatById = (seats: Seat[], seatId: string) =>
  seats.find((seat) => seat.id === seatId);
