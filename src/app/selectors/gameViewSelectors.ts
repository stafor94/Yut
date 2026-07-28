import type { Seat } from '../appTypes';

export const getOccupiedSeats = (seats: Seat[]) => seats.filter((seat) => !seat.isEmpty);

export const getActivePlayerSeats = (seats: Seat[]) =>
  seats.filter((seat) => !seat.isEmpty && !seat.isSpectator);

export const getSeatIndexFromLabel = (label: string) => Number(label.replace('P', '')) - 1;

export const findSeatById = (seats: Seat[], seatId: string) =>
  seats.find((seat) => seat.id === seatId);

export type TurnSeatResolution = {
  turnSeats: Seat[];
  activeSeat: Seat | undefined;
  previousSeat: Seat | undefined;
  nextSeat: Seat | undefined;
  pending: boolean;
  missingSeatIds: string[];
};

const normalizeTurnIndex = (turnIndex: number, seatCount: number) => {
  if (seatCount <= 0) return -1;
  const finiteIndex = Number.isFinite(turnIndex) ? Math.trunc(turnIndex) : 0;
  return ((finiteIndex % seatCount) + seatCount) % seatCount;
};

export function resolveTurnSeatResolution(
  seats: Seat[],
  turnOrderIds: string[],
  turnIndex: number,
): TurnSeatResolution {
  const playableSeats = getActivePlayerSeats(seats);
  if (!turnOrderIds.length) {
    const normalizedIndex = normalizeTurnIndex(turnIndex, playableSeats.length);
    const activeSeat = normalizedIndex >= 0 ? playableSeats[normalizedIndex] : undefined;
    return {
      turnSeats: playableSeats,
      activeSeat,
      previousSeat: normalizedIndex >= 0 && playableSeats.length > 1
        ? playableSeats[(normalizedIndex - 1 + playableSeats.length) % playableSeats.length]
        : undefined,
      nextSeat: normalizedIndex >= 0 && playableSeats.length > 1
        ? playableSeats[(normalizedIndex + 1) % playableSeats.length]
        : undefined,
      pending: false,
      missingSeatIds: [],
    };
  }

  const seatById = new Map(playableSeats.map((seat) => [seat.id, seat]));
  const missingSeatIds = Array.from(new Set(turnOrderIds.filter((seatId) => !seatById.has(seatId))));
  if (missingSeatIds.length) {
    return {
      turnSeats: [],
      activeSeat: undefined,
      previousSeat: undefined,
      nextSeat: undefined,
      pending: true,
      missingSeatIds,
    };
  }

  const turnSeats = turnOrderIds.map((seatId) => seatById.get(seatId)!);
  const normalizedIndex = normalizeTurnIndex(turnIndex, turnSeats.length);
  const activeSeat = normalizedIndex >= 0 ? turnSeats[normalizedIndex] : undefined;
  return {
    turnSeats,
    activeSeat,
    previousSeat: normalizedIndex >= 0 && turnSeats.length > 1
      ? turnSeats[(normalizedIndex - 1 + turnSeats.length) % turnSeats.length]
      : undefined,
    nextSeat: normalizedIndex >= 0 && turnSeats.length > 1
      ? turnSeats[(normalizedIndex + 1) % turnSeats.length]
      : undefined,
    pending: false,
    missingSeatIds: [],
  };
}
