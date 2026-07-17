import type { GameLog, Seat } from '../appState';

type BoardTurnIndicatorTextArgs = {
  activeSeatTurnText: string;
  getPlayerCardName: (seat: Seat) => string;
  logs: GameLog[];
  seats: Seat[];
  winner: string;
};

export function getBoardTurnIndicatorText({
  activeSeatTurnText,
  getPlayerCardName,
  logs,
  seats,
  winner,
}: BoardTurnIndicatorTextArgs) {
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
