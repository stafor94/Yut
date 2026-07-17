type BoardTurnIndicatorLog = {
  text: string;
};

type BoardTurnIndicatorTextArgs<TSeat, TLog extends BoardTurnIndicatorLog> = {
  activeSeatTurnText: string;
  getPlayerCardName: (seat: TSeat) => string;
  logs: TLog[];
  seats: TSeat[];
  winner: string;
};

export function getBoardTurnIndicatorText<TSeat, TLog extends BoardTurnIndicatorLog>({
  activeSeatTurnText,
  getPlayerCardName,
  logs,
  seats,
  winner,
}: BoardTurnIndicatorTextArgs<TSeat, TLog>) {
  if (!winner) return activeSeatTurnText;

  for (const log of logs) {
    const matchedSeat = seats.find((seat) => {
      const displayName = getPlayerCardName(seat).trim();
      return Boolean(displayName && log.text.startsWith(`${displayName}님`));
    });
    if (matchedSeat) return getPlayerCardName(matchedSeat);
  }

  const winnerName = winner.endsWith(' 승리') ? winner.slice(0, -3).trim() : '';
  const winnerSeat = winnerName
    ? seats.find((seat) => getPlayerCardName(seat).trim() === winnerName)
    : undefined;
  return winnerSeat ? getPlayerCardName(winnerSeat) : activeSeatTurnText;
}
