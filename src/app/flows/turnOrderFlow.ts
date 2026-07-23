import type { RollTimingZone, YutResult, YutResultName, YutStick } from '../../game-core/roll';
import type { PlayMode, Team } from '../appTypes';

export type TurnOrderResultName = Exclude<YutResultName, '황금 윷'> | '낙';
export type TurnOrderSubmissionSource = 'manual' | 'auto';
export type TurnOrderSubmission = {
  seatId: string;
  roundId: string;
  resultName: TurnOrderResultName;
  displayResult: YutResult;
  sticks: YutStick[];
  fallCount: number;
  timingZone: RollTimingZone;
  source: TurnOrderSubmissionSource;
  submittedAt: number;
};
export type TurnOrderBracket = {
  id: string;
  rankStart: number;
  seatIds: string[];
};
export type TurnOrderRound = {
  id: string;
  index: number;
  startAt: number;
  deadlineAt: number;
  eligibleSeatIds: string[];
  brackets: TurnOrderBracket[];
  submissions: TurnOrderSubmission[];
  status: 'collecting' | 'reveal-pending';
  aggregatedAt?: number;
  revealAt?: number;
};
export type TurnOrderIntroEntry = {
  seatId: string;
  label: string;
  name: string;
  color: string;
  team: Team;
  isAI?: boolean;
};
export type TurnOrderIntro = {
  version: 3;
  roomId: string;
  sessionId: string;
  playMode: PlayMode;
  order: TurnOrderIntroEntry[];
  visible: boolean;
  readyAt: number;
  placements: Record<string, number>;
  currentRound: TurnOrderRound;
  nextRound?: TurnOrderRound | null;
  finalIndividualOrderIds?: string[];
  finalTurnOrderIds?: string[];
  finalOrderAt?: number;
  gameStartAt?: number;
};

export type TurnOrderTeam = '청팀' | '홍팀';
export type TurnOrderSeat = {
  id: string;
  label: string;
  name: string;
  color: string;
  team: TurnOrderTeam;
  isAI?: boolean;
};
export type TurnOrderRollEntry<TSeat extends TurnOrderSeat = TurnOrderSeat> = { seat: TSeat; result: YutResult; rollOffRound: number };

const TURN_ORDER_TEAM_COLORS: Record<TurnOrderTeam, string> = { 청팀: '#3a78c2', 홍팀: '#d94a38' };
export const TURN_ORDER_INITIAL_DELAY_MS = 8_000;
export const TURN_ORDER_ROUND_DURATION_MS = 8_000;
export const TURN_ORDER_REVEAL_DELAY_MS = 3_000;
export const TURN_ORDER_RESULT_HOLD_MS = 3_000;
export const TURN_ORDER_PRESENTATION_FINAL_HOLD_MS = 3_000;
const TURN_ORDER_SAFETY_TIMEOUT_MS = 30 * 60_000;

export const getTurnOrderScore = (value: YutResult | TurnOrderSubmission) => {
  if ('resultName' in value) {
    if (value.resultName === '낙') return -2;
    if (value.resultName === '빽도') return -1;
    return value.displayResult.steps;
  }
  return value.name === '빽도' ? -1 : value.steps;
};

export function buildAlternatingTeamTurnOrder<TSeat extends TurnOrderSeat>(rankedRolls: TurnOrderRollEntry<TSeat>[]) {
  const teamRankings = {
    청팀: rankedRolls.filter((entry) => entry.seat.team === '청팀'),
    홍팀: rankedRolls.filter((entry) => entry.seat.team === '홍팀'),
  };
  const firstTeam: TurnOrderTeam = rankedRolls[0]?.seat.team ?? '청팀';
  const secondTeam: TurnOrderTeam = firstTeam === '청팀' ? '홍팀' : '청팀';
  const teamQueues: Record<TurnOrderTeam, TurnOrderRollEntry<TSeat>[]> = { 청팀: [...teamRankings.청팀], 홍팀: [...teamRankings.홍팀] };
  const turnOrder: TSeat[] = [];
  let preferredTeam: TurnOrderTeam = firstTeam;

  while (teamQueues.청팀.length || teamQueues.홍팀.length) {
    const previousTeam = turnOrder[turnOrder.length - 1]?.team;
    const oppositeTeam = previousTeam === '청팀' ? '홍팀' : '청팀';
    const nextTeam = previousTeam && teamQueues[oppositeTeam].length
      ? oppositeTeam
      : teamQueues[preferredTeam].length
        ? preferredTeam
        : secondTeam;
    const nextRoll = teamQueues[nextTeam].shift();
    if (!nextRoll) break;
    turnOrder.push(nextRoll.seat);
    preferredTeam = nextTeam === firstTeam ? secondTeam : firstTeam;
  }

  return turnOrder;
}

export const formatTurnOrderSummary = <TSeat extends TurnOrderSeat>(turnOrder: TSeat[], getSeatDisplayName: (seat: TSeat) => string) => `순서: ${turnOrder.map((seat) => getSeatDisplayName(seat)).join(' > ')}`;

export function shuffleSeatsForGame<TSeat extends TurnOrderSeat>(targetSeats: TSeat[]) {
  const shuffledSeats = [...targetSeats];
  for (let index = shuffledSeats.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledSeats[index], shuffledSeats[swapIndex]] = [shuffledSeats[swapIndex], shuffledSeats[index]];
  }
  return shuffledSeats;
}

const makeRoundId = (sessionId: string, index: number) => `${sessionId}:round:${index}`;
const makeBracketId = (roundIndex: number, rankStart: number, seatIds: string[]) => `r${roundIndex}:rank${rankStart}:${seatIds.join('-')}`;

export function createTurnOrderRound(params: {
  sessionId: string;
  index: number;
  startAt: number;
  brackets: Array<Pick<TurnOrderBracket, 'rankStart' | 'seatIds'>>;
}): TurnOrderRound {
  const { sessionId, index, startAt } = params;
  const brackets = params.brackets.map((bracket) => ({
    id: makeBracketId(index, bracket.rankStart, bracket.seatIds),
    rankStart: bracket.rankStart,
    seatIds: [...bracket.seatIds],
  }));
  return {
    id: makeRoundId(sessionId, index),
    index,
    startAt,
    deadlineAt: startAt + TURN_ORDER_ROUND_DURATION_MS,
    eligibleSeatIds: brackets.flatMap((bracket) => bracket.seatIds),
    brackets,
    submissions: [],
    status: 'collecting',
  };
}

type CreateTurnOrderIntroOptions<TSeat extends TurnOrderSeat> = {
  getSeatPieceColor: (seat: TSeat) => string;
  playMode: 'individual' | 'team';
  roomId?: string;
  startRequestVersion?: number;
  startAt?: number;
  now?: number;
  finalHoldMs?: number;
};

export function createTurnOrderIntro<TSeat extends TurnOrderSeat>(seats: TSeat[], options: CreateTurnOrderIntroOptions<TSeat>) {
  const now = options.now ?? Date.now();
  const startAt = options.startAt ?? now + TURN_ORDER_INITIAL_DELAY_MS;
  const roomId = options.roomId ?? 'local';
  const startRequestVersion = options.startRequestVersion ?? 0;
  const sessionId = `${roomId}:${startRequestVersion || startAt}`;
  const order = seats.map((seat) => ({
    seatId: seat.id,
    label: seat.label,
    name: seat.name,
    color: options.playMode === 'team' ? TURN_ORDER_TEAM_COLORS[seat.team] : options.getSeatPieceColor(seat),
    team: seat.team,
    isAI: seat.isAI,
  }));
  const currentRound = createTurnOrderRound({
    sessionId,
    index: 1,
    startAt,
    brackets: [{ rankStart: 1, seatIds: order.map((entry) => entry.seatId) }],
  });
  const intro: TurnOrderIntro = {
    version: 3,
    roomId,
    sessionId,
    playMode: options.playMode,
    order,
    visible: true,
    readyAt: startAt + TURN_ORDER_SAFETY_TIMEOUT_MS,
    placements: {},
    currentRound,
    nextRound: null,
    finalIndividualOrderIds: [],
    finalTurnOrderIds: [],
  };
  return { intro };
}

export const activateNextTurnOrderRound = (intro: TurnOrderIntro, now = Date.now()): TurnOrderIntro => {
  if (!intro.nextRound || now < intro.nextRound.startAt) return intro;
  return {
    ...intro,
    currentRound: intro.nextRound,
    nextRound: null,
  };
};

export const submitTurnOrderResult = (intro: TurnOrderIntro, submission: TurnOrderSubmission, now = Date.now()): TurnOrderIntro => {
  const activeIntro = activateNextTurnOrderRound(intro, now);
  const round = activeIntro.currentRound;
  if (round.status !== 'collecting') return activeIntro;
  if (submission.roundId !== round.id || !round.eligibleSeatIds.includes(submission.seatId)) return activeIntro;
  if (round.submissions.some((entry) => entry.seatId === submission.seatId)) return activeIntro;
  return {
    ...activeIntro,
    currentRound: {
      ...round,
      submissions: [...round.submissions, submission],
    },
  };
};

const groupSubmissionsByScore = (submissions: TurnOrderSubmission[]) => {
  const groups = new Map<number, TurnOrderSubmission[]>();
  submissions.forEach((submission) => {
    const score = getTurnOrderScore(submission);
    groups.set(score, [...(groups.get(score) ?? []), submission]);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, entries]) => entries);
};

const getFinalIndividualOrderIds = (intro: TurnOrderIntro, placements: Record<string, number>) => intro.order
  .map((entry) => entry.seatId)
  .sort((left, right) => (placements[left] ?? Number.MAX_SAFE_INTEGER) - (placements[right] ?? Number.MAX_SAFE_INTEGER));

const getFinalTurnOrderIds = (intro: TurnOrderIntro, individualOrderIds: string[]) => {
  if (intro.playMode !== 'team') return individualOrderIds;
  const entryBySeatId = new Map(intro.order.map((entry) => [entry.seatId, entry]));
  const rankedEntries = individualOrderIds
    .map((seatId) => entryBySeatId.get(seatId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry, index) => ({ seat: { id: entry.seatId, label: entry.label, name: entry.name, color: entry.color, team: entry.team, isAI: entry.isAI }, result: { name: '도', steps: 1 } as YutResult, rollOffRound: index + 1 }));
  return buildAlternatingTeamTurnOrder(rankedEntries).map((entry) => entry.id);
};

export const canAggregateTurnOrderRound = (intro: TurnOrderIntro, now = Date.now()) => intro.currentRound.status === 'collecting'
  && now >= intro.currentRound.deadlineAt
  && intro.currentRound.eligibleSeatIds.every((seatId) => intro.currentRound.submissions.some((submission) => submission.seatId === seatId));

export const aggregateTurnOrderRound = (intro: TurnOrderIntro, now = Date.now()): TurnOrderIntro => {
  const activeIntro = activateNextTurnOrderRound(intro, now);
  if (!canAggregateTurnOrderRound(activeIntro, now)) return activeIntro;

  const round = activeIntro.currentRound;
  const placements = { ...activeIntro.placements };
  const tieBrackets: TurnOrderBracket[] = [];

  round.brackets.forEach((bracket) => {
    const bracketSubmissions = bracket.seatIds
      .map((seatId) => round.submissions.find((submission) => submission.seatId === seatId))
      .filter((submission): submission is TurnOrderSubmission => Boolean(submission));
    let rank = bracket.rankStart;
    groupSubmissionsByScore(bracketSubmissions).forEach((group) => {
      if (group.length === 1) placements[group[0].seatId] = rank;
      else tieBrackets.push({ id: makeBracketId(round.index + 1, rank, group.map((entry) => entry.seatId)), rankStart: rank, seatIds: group.map((entry) => entry.seatId) });
      rank += group.length;
    });
  });

  const aggregatedAt = now;
  const revealAt = aggregatedAt + TURN_ORDER_REVEAL_DELAY_MS;
  const currentRound: TurnOrderRound = {
    ...round,
    status: 'reveal-pending',
    aggregatedAt,
    revealAt,
  };

  if (tieBrackets.length) {
    const nextRoundStartAt = revealAt + TURN_ORDER_RESULT_HOLD_MS;
    return {
      ...activeIntro,
      placements,
      currentRound,
      nextRound: createTurnOrderRound({
        sessionId: activeIntro.sessionId,
        index: round.index + 1,
        startAt: nextRoundStartAt,
        brackets: tieBrackets,
      }),
    };
  }

  const finalIndividualOrderIds = getFinalIndividualOrderIds(activeIntro, placements);
  const finalTurnOrderIds = getFinalTurnOrderIds(activeIntro, finalIndividualOrderIds);
  const finalOrderAt = revealAt + TURN_ORDER_RESULT_HOLD_MS;
  const gameStartAt = finalOrderAt + TURN_ORDER_PRESENTATION_FINAL_HOLD_MS;
  return {
    ...activeIntro,
    placements,
    currentRound,
    nextRound: null,
    finalIndividualOrderIds,
    finalTurnOrderIds,
    finalOrderAt,
    gameStartAt,
    readyAt: gameStartAt,
  };
};

export const isTurnOrderFinalized = (intro: TurnOrderIntro) => Boolean(
  intro.gameStartAt
  && intro.finalTurnOrderIds?.length === intro.order.length,
);
