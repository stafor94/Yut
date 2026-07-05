import type { CSSProperties } from 'react';
import { TEAM_COLORS, type PlayMode, type Seat } from '../appState';

type GameLogPresentationOptions = {
  getSeatDisplayName: (seat: Seat) => string;
  getSeatPieceColor: (seat: Seat | undefined) => string;
  playableSeats: Seat[];
  playMode: PlayMode;
};

export const isTurnOrderSystemLog = (text: string) => text.startsWith('순서 정하기:')
  || text.startsWith('순서:')
  || text.includes('자동 순서 정하기 굴림')
  || text.includes('재윷을 던집니다.');

const getReadableLogTextColor = (backgroundColor: string) => {
  const hex = backgroundColor.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#2a1e17';
  const [red, green, blue] = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? '#2a1e17' : '#fffaf0';
};

export function createGameLogPresentation({ getSeatDisplayName, getSeatPieceColor, playableSeats, playMode }: GameLogPresentationOptions) {
  const getLogSeatTokens = () => playableSeats
    .flatMap((seat) => [`${seat.label}-${seat.name}`, getSeatDisplayName(seat), seat.label, seat.id].filter(Boolean).map((token) => ({ seat, token })))
    .sort((left, right) => right.token.length - left.token.length);

  const getEscapedLogSeatTokens = () => getLogSeatTokens().map((entry) => ({ ...entry, escapedToken: entry.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }));

  const getLogSeat = (text: string) => {
    const tokenEntries = getEscapedLogSeatTokens();
    if (tokenEntries.length) {
      const match = text.match(new RegExp(`(?<![A-Za-z0-9_])(${tokenEntries.map((entry) => entry.escapedToken).join('|')})(?![A-Za-z0-9_])`, 'u'));
      const matchedSeat = match ? tokenEntries.find((entry) => entry.token === match[1])?.seat : undefined;
      if (matchedSeat) return matchedSeat;
    }
    const labelMatch = text.match(/P([1-4])(?:-|\b)/u);
    return labelMatch ? playableSeats.find((seat) => seat.label === `P${labelMatch[1]}`) : undefined;
  };

  const getLogCardStyle = (text: string, previousText = ''): CSSProperties => {
    if (isTurnOrderSystemLog(text)) return {};
    const shouldInheritPreviousLogColor = text.includes('한 번 더 던질 수 있습니다.');
    const seat = getLogSeat(text) ?? (shouldInheritPreviousLogColor ? getLogSeat(previousText) : undefined);
    if (!seat) return {};
    const backgroundColor = playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat);
    return { '--log-card-bg': backgroundColor, '--log-card-color': seat.label === 'P4' ? '#fffaf0' : getReadableLogTextColor(backgroundColor), '--log-card-border': backgroundColor } as CSSProperties;
  };

  const renderLogText = (text: string) => {
    const displayText = text
      .replace(/\(-?\d+칸\)/g, '')
      .replace(/이\(가\)/g, '님이')
      .replace(/은\(는\)/g, '님은')
      .replace(/의(?= 말| 모든| 방금)/g, '님의')
      .replace(/님님의/g, '님의');
    const shouldColorPlayerTokens = !isTurnOrderSystemLog(text) || text.startsWith('순서:');
    if (!shouldColorPlayerTokens) return displayText;
    const tokenEntries = getEscapedLogSeatTokens();
    if (!tokenEntries.length) return displayText;
    return displayText.split(new RegExp(`(?<![A-Za-z0-9_])(${tokenEntries.map((entry) => entry.escapedToken).join('|')})(?![A-Za-z0-9_])`, 'gu')).map((part, index) => {
      const seat = tokenEntries.find((entry) => entry.token === part)?.seat;
      if (!seat) return part;
      const color = playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat);
      return <span className="log-player-label" style={{ '--log-player-color': color } as CSSProperties} key={`${part}-${index}`}>{getSeatDisplayName(seat)}</span>;
    });
  };

  return { getLogCardStyle, renderLogText };
}
