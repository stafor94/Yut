type OnlineGameCoordinatorSeat = {
  id: string;
  isAI?: boolean;
  isEmpty?: boolean;
};

export const getOnlineGameCoordinatorSeatId = (seats: OnlineGameCoordinatorSeat[]) =>
  seats.find((seat) => !seat.isEmpty && !seat.isAI)?.id ?? '';

export const getHumanSeatsWaitingForGameEntry = <TSeat extends OnlineGameCoordinatorSeat & { isSpectator?: boolean; enteredStartVersion?: number }>(seats: TSeat[], startRequestVersion: number, optimisticEnteredSeatId = '') =>
  seats.filter((seat) => !seat.isEmpty && !seat.isAI && !seat.isSpectator && seat.enteredStartVersion !== startRequestVersion && seat.id !== optimisticEnteredSeatId);

export const haveAllHumanSeatsEnteredGame = <TSeat extends OnlineGameCoordinatorSeat & { isSpectator?: boolean; enteredStartVersion?: number }>(seats: TSeat[], startRequestVersion: number, optimisticEnteredSeatId = '') =>
  getHumanSeatsWaitingForGameEntry(seats, startRequestVersion, optimisticEnteredSeatId).length === 0;
