import type { YutResult } from '../../game-core/roll';
import { rollYutResult } from '../../game-core/roll';
import { TURN_ORDER_PRESENTATION_PREPARE_MS, getTurnOrderSlotRevealDurationMs } from './turnOrderPresentation';

export type TurnOrderTeam = '청팀' | '홍팀';
export type TurnOrderSeat = {
  id: string;
  label: string;
  name: string;
  color: string;
  team: TurnOrderTeam;
};
export type TurnOrderRollEntry<TSeat extends TurnOrderSeat = TurnOrderSeat> = { seat: TSeat; result: YutResult; rollOffRound: number };

const TURN_ORDER_TEAM_COLORS: Record<TurnOrderTeam, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
export const TURN_ORDER_PRESENTATION_FINAL_HOLD_MS = 3000;

export const getTurnOrderScore = (result: YutResult) => result.name === '빽도' ? 0 : result.steps;

export function buildAlternatingTeamTurnOrder<TSeat extends TurnOrderSeat>(rankedRolls: TurnOrderRollEntry<TSeat>[]) {
  const teamRankings = {
    청팀: rankedRolls.filter((entry) => entry.seat.team === '청팀'),
    홍팀: rankedRolls.filter((entry) => entry.seat.team === '홍팀'),
  };
  const blueTopScore = getTurnOrderScore((teamRankings.청팀[0] ?? rankedRolls[0]).result);
  const redTopScore = getTurnOrderScore((teamRankings.홍팀[0] ?? rankedRolls[0]).result);
  const firstTeam: TurnOrderTeam = blueTopScore >= redTopScore ? '청팀' : '홍팀';
  const secondTeam: TurnOrderTeam = firstTeam === '청팀' ? '홍팀' : '청팀';
  const teamQueues: Record<TurnOrderTeam, TurnOrderRollEntry<TSeat>[]> = { 청팀: [...teamRankings.청팀], 홍팀: [...teamRankings.홍팀] };
  const turnOrder: TSeat[] = [];
  let preferredTeam: TurnOrderTeam = firstTeam;

  while (teamQueues.청팀.length || teamQueues.홍팀.length) {
    const previousTeam = turnOrder[turnOrder.length - 1]?.team;
    const oppositeTeam = previousTeam === '청팀' ? '홍팀' : '청팀';
    const nextTeam = previousTeam && teamQueues[oppositeTeam].length ? oppositeTeam : teamQueues[preferredTeam].length ? preferredTeam : secondTeam;
    const nextRoll = teamQueues[nextTeam].shift();
    if (!nextRoll) break;
    turnOrder.push(nextRoll.seat);
    preferredTeam = nextTeam === firstTeam ? secondTeam : firstTeam;
  }

  return turnOrder;
}

export function getTurnOrderFromRolls<TSeat extends TurnOrderSeat>(rolls: TurnOrderRollEntry<TSeat>[], playMode: 'individual' | 'team') {
  const rankedRolls = [...rolls].sort((left, right) => getTurnOrderScore(right.result) - getTurnOrderScore(left.result));
  const turnOrder = playMode === 'team'
    ? buildAlternatingTeamTurnOrder(rankedRolls)
    : rankedRolls.map((entry) => entry.seat);
  return { rankedRolls, turnOrder };
}

type ResolveTurnOrderRollsOptions<TSeat extends TurnOrderSeat> = {
  getSeatDisplayName: (seat: TSeat) => string;
  onTie: (message: string) => void;
};

export function resolveTurnOrderRolls<TSeat extends TurnOrderSeat>(targetSeats: TSeat[], options: ResolveTurnOrderRollsOptions<TSeat>, rollOffRound = 1): TurnOrderRollEntry<TSeat>[] {
  const firstRolls = targetSeats.map((seat) => ({ ...rollYutResult(undefined, false), seat }));
  const grouped = firstRolls.reduce<Record<number, typeof firstRolls>>((acc, rollEntry) => {
    const score = getTurnOrderScore(rollEntry.result);
    return { ...acc, [score]: [...(acc[score] ?? []), rollEntry] };
  }, {});

  return Object.entries(grouped)
    .flatMap(([, entries]) => {
      if (entries.length === 1) return [{ seat: entries[0].seat, result: entries[0].result, rollOffRound }];
      options.onTie(`${entries.map((entry) => options.getSeatDisplayName(entry.seat)).join(', ')}님이 ${entries[0].result.name}로 비겨 재윷을 던집니다.`);
      return resolveTurnOrderRolls(entries.map((entry) => entry.seat), options, rollOffRound + 1);
    })
    .sort((left, right) => getTurnOrderScore(right.result) - getTurnOrderScore(left.result));
}

export const formatTurnOrderSummary = <TSeat extends TurnOrderSeat>(turnOrder: TSeat[], getSeatDisplayName: (seat: TSeat) => string) => `순서: ${turnOrder.map((seat) => getSeatDisplayName(seat)).join(' > ')}`;

export function getTurnOrderLogTexts<TSeat extends TurnOrderSeat>(rankedRolls: TurnOrderRollEntry<TSeat>[], turnOrder: TSeat[], getSeatDisplayName: (seat: TSeat) => string) {
  const rollSummary = rankedRolls.map((entry) => `${getSeatDisplayName(entry.seat)} ${entry.result.name}${entry.rollOffRound > 1 ? `(${entry.rollOffRound}차)` : ''}`).join(' · ');
  return [
    `순서 정하기: ${rollSummary}`,
    formatTurnOrderSummary(turnOrder, getSeatDisplayName),
  ];
}

export function shuffleSeatsForGame<TSeat extends TurnOrderSeat>(targetSeats: TSeat[]) {
  const shuffledSeats = [...targetSeats];
  for (let index = shuffledSeats.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledSeats[index], shuffledSeats[swapIndex]] = [shuffledSeats[swapIndex], shuffledSeats[index]];
  }
  return shuffledSeats;
}

type CreateTurnOrderIntroOptions<TSeat extends TurnOrderSeat> = {
  getSeatPieceColor: (seat: TSeat) => string;
  playMode: 'individual' | 'team';
  finalHoldMs: number;
  now?: number;
};

export function createTurnOrderIntro<TSeat extends TurnOrderSeat>(orderedSeats: TSeat[], { getSeatPieceColor, playMode, finalHoldMs, now = Date.now() }: CreateTurnOrderIntroOptions<TSeat>) {
  const order = orderedSeats.map((seat) => ({ seatId: seat.id, label: seat.label, name: seat.name, color: playMode === 'team' ? TURN_ORDER_TEAM_COLORS[seat.team] : getSeatPieceColor(seat) }));
  const slotUntil = now + TURN_ORDER_PRESENTATION_PREPARE_MS + getTurnOrderSlotRevealDurationMs(order.length);
  const finalHoldDurationMs = Math.max(finalHoldMs, TURN_ORDER_PRESENTATION_FINAL_HOLD_MS);
  return { order, slotUntil, intro: { order, visible: true, slotUntil, readyAt: slotUntil + finalHoldDurationMs } };
}
