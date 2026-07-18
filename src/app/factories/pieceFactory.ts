import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { PieceCount, PlayMode, Seat, Team } from '../appTypes';
import { PLAYER_COLORS, TEAM_COLORS } from '../constants/playerPresentation';
import { getOccupiedSeats, getSeatIndexFromLabel } from '../selectors/gameViewSelectors';

export const makePieces = (
  seats: Seat[],
  pieceCount: PieceCount,
  mode: PlayMode = 'individual',
): BoardPiece[] => {
  const activeSeats = getOccupiedSeats(seats);

  if (mode === 'team') {
    return (['청팀', '홍팀'] as Team[]).flatMap((team) => {
      const teamSeats = activeSeats.filter((seat) => seat.team === team);
      return Array.from({ length: pieceCount }, (_, pieceIndex) => {
        const ownerSeat = teamSeats[pieceIndex % Math.max(teamSeats.length, 1)] ?? teamSeats[0];
        return {
          id: `${team}-piece-${pieceIndex + 1}`,
          ownerId: ownerSeat?.id ?? team,
          label: `${team === '청팀' ? '청' : '홍'}-${pieceIndex + 1}`,
          color: TEAM_COLORS[team],
          nodeIndex: 0,
          nodeId: 'n01',
          started: false,
          finished: false,
        };
      });
    });
  }

  return activeSeats.flatMap((seat) =>
    Array.from({ length: pieceCount }, (_, pieceIndex) => ({
      id: `${seat.id}-piece-${pieceIndex + 1}`,
      ownerId: seat.id,
      label: `${seat.label}-${pieceIndex + 1}`,
      color: PLAYER_COLORS[getSeatIndexFromLabel(seat.label)] ?? '#2a1e17',
      nodeIndex: 0,
      nodeId: 'n01',
      started: false,
      finished: false,
    })),
  );
};
