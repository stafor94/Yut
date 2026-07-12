type OnlineGameCoordinatorSeat = {
  id: string;
  isAI?: boolean;
  isEmpty?: boolean;
};

const isEligibleOnlineGameCoordinator = (seat: OnlineGameCoordinatorSeat) => !seat.isEmpty && !seat.isAI;

export const getOnlineGameCoordinatorSeatId = (seats: OnlineGameCoordinatorSeat[], preferredCoordinatorSeatId = '') => {
  if (preferredCoordinatorSeatId && seats.some((seat) => seat.id === preferredCoordinatorSeatId && isEligibleOnlineGameCoordinator(seat))) {
    return preferredCoordinatorSeatId;
  }
  return seats.find(isEligibleOnlineGameCoordinator)?.id ?? '';
};

export const getHumanSeatsWaitingForGameEntry = <TSeat extends OnlineGameCoordinatorSeat & { isSpectator?: boolean; enteredStartVersion?: number }>(seats: TSeat[], startRequestVersion: number, optimisticEnteredSeatId = '') =>
  seats.filter((seat) => !seat.isEmpty && !seat.isAI && !seat.isSpectator && seat.enteredStartVersion !== startRequestVersion && seat.id !== optimisticEnteredSeatId);

export const haveAllHumanSeatsEnteredGame = <TSeat extends OnlineGameCoordinatorSeat & { isSpectator?: boolean; enteredStartVersion?: number }>(seats: TSeat[], startRequestVersion: number, optimisticEnteredSeatId = '') =>
  getHumanSeatsWaitingForGameEntry(seats, startRequestVersion, optimisticEnteredSeatId).length === 0;
