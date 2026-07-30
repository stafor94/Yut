import { createElement, type ReactNode } from 'react';

type BoardTurnIndicatorLog = {
  text: string;
};

type BoardTurnIndicatorSeat = {
  id?: string;
  label?: string;
  team?: string;
};

type BoardTurnIndicatorTextArgs<TSeat extends BoardTurnIndicatorSeat, TLog extends BoardTurnIndicatorLog> = {
  activeSeatTurnText: string;
  getPlayerCardName: (seat: TSeat) => string;
  logs: TLog[];
  seats: TSeat[];
  winner: string;
};

const makeWinnerNameElement = (text: string, colorClassName: string): ReactNode => createElement(
  'span',
  { className: `winner-turn-names ${colorClassName}` },
  text,
);

const getSeatWinnerColorClassName = (seat: BoardTurnIndicatorSeat) => {
  const playerNumber = Number(seat.label?.replace('P', ''));
  return Number.isInteger(playerNumber) && playerNumber >= 1 && playerNumber <= 4
    ? `winner-player-${playerNumber}`
    : '';
};

export function getBoardTurnIndicatorText<TSeat extends BoardTurnIndicatorSeat, TLog extends BoardTurnIndicatorLog>({
  activeSeatTurnText,
  getPlayerCardName,
  logs,
  seats,
  winner,
}: BoardTurnIndicatorTextArgs<TSeat, TLog>): ReactNode {
  if (!winner) return activeSeatTurnText;

  const winnerName = winner.endsWith(' 승리') ? winner.slice(0, -3).trim() : '';
  if (winnerName === '청팀' || winnerName === '홍팀') {
    const winnerNamesBySeat = new Map<string, string>();
    seats.forEach((seat) => {
      if (seat.team !== winnerName) return;
      const displayName = getPlayerCardName(seat).trim();
      if (!displayName) return;
      winnerNamesBySeat.set(seat.id || displayName, displayName);
    });
    const winnerNames = Array.from(winnerNamesBySeat.values());
    if (winnerNames.length) {
      return makeWinnerNameElement(
        winnerNames.join(' · '),
        winnerName === '청팀' ? 'winner-team-blue' : 'winner-team-red',
      );
    }
  }

  const winnerSeat = winnerName
    ? seats.find((seat) => getPlayerCardName(seat).trim() === winnerName)
    : undefined;
  if (winnerSeat) {
    return makeWinnerNameElement(getPlayerCardName(winnerSeat), getSeatWinnerColorClassName(winnerSeat));
  }

  for (const log of logs) {
    const matchedSeat = seats.find((seat) => {
      const displayName = getPlayerCardName(seat).trim();
      return Boolean(displayName && log.text.startsWith(`${displayName}님`));
    });
    if (matchedSeat) {
      return makeWinnerNameElement(getPlayerCardName(matchedSeat), getSeatWinnerColorClassName(matchedSeat));
    }
  }

  return activeSeatTurnText;
}
