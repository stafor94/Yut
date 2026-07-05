type OnlineGameCoordinatorSeat = {
  id: string;
  isAI?: boolean;
  isEmpty?: boolean;
};

export const getOnlineGameCoordinatorSeatId = (seats: OnlineGameCoordinatorSeat[]) =>
  seats.find((seat) => !seat.isEmpty && !seat.isAI)?.id ?? '';
