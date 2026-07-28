export const PRIMARY_TIMING_STAT_LABELS = ['PERFECT', 'NICE', 'GOOD', 'BAD'] as const;
export const TIMING_STAT_LABELS = [...PRIMARY_TIMING_STAT_LABELS, '미확인'] as const;
export const YUT_STAT_LABELS = ['빽도', '도', '개', '걸', '윷', '모', '낙', '미확인'] as const;

export type PrimaryTimingStatLabel = (typeof PRIMARY_TIMING_STAT_LABELS)[number];
export type TimingStatLabel = (typeof TIMING_STAT_LABELS)[number];
export type YutStatLabel = (typeof YUT_STAT_LABELS)[number];

export type GameStatisticsSeatSource = {
  id?: unknown;
  label?: unknown;
  name?: unknown;
  seatIndex?: unknown;
  isAI?: unknown;
  isSubstitutedByAI?: unknown;
};

export type GameStatisticsStateSource = {
  gameSeats?: readonly GameStatisticsSeatSource[];
};

export type GameStatisticsSequence = {
  sequence: number;
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
  action?: {
    type?: unknown;
    actorId?: unknown;
    payload?: Record<string, unknown>;
  } | null;
  stateBefore?: unknown;
  stateAfter?: unknown;
};

export type GameStatisticsSeat = {
  id: string;
  label: string;
  name: string;
  seatIndex: number;
  isAI: boolean;
};

export type PlayerRollStatisticsRecord = {
  sequence: number;
  timing: TimingStatLabel;
  result: YutStatLabel;
};

export type GameStatisticsBreakdown<TLabel extends string> = {
  label: TLabel;
  count: number;
  percentage: number;
};

export type GameStatisticsRollGroup = {
  records: PlayerRollStatisticsRecord[];
  leadingEmptyColumns: number;
};

export type VisibleTimingStatistics = {
  primary: GameStatisticsBreakdown<PrimaryTimingStatLabel>[];
  unknown: GameStatisticsBreakdown<'미확인'> | null;
};

export type PlayerGameStatistics = {
  seat: GameStatisticsSeat;
  rolls: PlayerRollStatisticsRecord[];
  totalRolls: number;
  timing: GameStatisticsBreakdown<TimingStatLabel>[];
  yut: GameStatisticsBreakdown<YutStatLabel>[];
  capturedPieceCount: number;
};

const readObject = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const readString = (...values: unknown[]) => {
  const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim() : '';
};

const readBoolean = (...values: unknown[]) => {
  const value = values.find((candidate) => typeof candidate === 'boolean');
  return typeof value === 'boolean' ? value : undefined;
};

const readStringArray = (...values: unknown[]) => {
  const value = values.find(Array.isArray);
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
};

export function formatStatisticsPercentage(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

export function normalizeTimingResult(sequence: GameStatisticsSequence): TimingStatLabel {
  const payload = sequence.payload ?? {};
  const actionPayload = sequence.action?.payload ?? {};
  const raw = readString(
    payload.timingZone,
    payload.rollTimingZone,
    actionPayload.rollTimingZone,
    actionPayload.timingZone,
  ).toLowerCase();

  if (raw === 'perfect') return 'PERFECT';
  if (raw === 'nice') return 'NICE';
  if (raw === 'good') return 'GOOD';
  if (raw === 'bad' || raw === 'normal') return 'BAD';
  return '미확인';
}

const readRollName = (sequence: GameStatisticsSequence) => {
  const payload = sequence.payload ?? {};
  const actionPayload = sequence.action?.payload ?? {};
  const displayRoll = readObject(payload.displayRoll);
  const selectedGoldenYutResult = readObject(actionPayload.selectedGoldenYutResult);
  const clientRollResult = readObject(actionPayload.clientRollResult);
  return readString(
    displayRoll?.name,
    payload.rollName,
    selectedGoldenYutResult?.name,
    clientRollResult?.name,
  );
};

export function normalizeYutResult(sequence: GameStatisticsSequence): YutStatLabel {
  const payload = sequence.payload ?? {};
  const actionPayload = sequence.action?.payload ?? {};
  const fallOccurred = readBoolean(payload.fallOccurred, actionPayload.clientFallOccurred);
  if (fallOccurred === true) return '낙';

  const rollName = readRollName(sequence);
  if (rollName === '빽도' || rollName === '도' || rollName === '개' || rollName === '걸' || rollName === '윷' || rollName === '모') return rollName;
  return '미확인';
}

const makeBreakdown = <TLabel extends string>(
  labels: readonly TLabel[],
  records: readonly TLabel[],
  total: number,
): GameStatisticsBreakdown<TLabel>[] => labels.map((label) => {
  const count = records.filter((record) => record === label).length;
  return {
    label,
    count,
    percentage: total > 0 ? (count / total) * 100 : 0,
  };
});

export function buildGameStatisticsRollGroups(
  records: readonly PlayerRollStatisticsRecord[],
  columns = 3,
): GameStatisticsRollGroup[] {
  const normalizedColumns = Number.isInteger(columns) && columns > 0 ? columns : 3;
  const ascendingRecords = [...records].sort((left, right) => left.sequence - right.sequence);
  const ascendingGroups: PlayerRollStatisticsRecord[][] = [];

  for (let start = 0; start < ascendingRecords.length; start += normalizedColumns) {
    ascendingGroups.push(ascendingRecords.slice(start, start + normalizedColumns));
  }

  return ascendingGroups.reverse().map((groupRecords, groupIndex) => ({
    records: groupRecords,
    leadingEmptyColumns: groupIndex === 0
      ? normalizedColumns - groupRecords.length
      : 0,
  }));
}

export function getVisibleTimingStatistics(
  entries: readonly GameStatisticsBreakdown<TimingStatLabel>[],
): VisibleTimingStatistics {
  const primary = PRIMARY_TIMING_STAT_LABELS.map((label) => {
    const entry = entries.find((candidate) => candidate.label === label);
    return entry
      ? { ...entry, label }
      : { label, count: 0, percentage: 0 };
  });
  const unknown = entries.find((entry) => entry.label === '미확인');

  return {
    primary,
    unknown: unknown && unknown.count > 0
      ? { ...unknown, label: '미확인' }
      : null,
  };
}

const getCapturedPieceCount = (sequence: GameStatisticsSequence) => {
  if (sequence.type !== 'move_piece_resolved') return 0;
  const payload = sequence.payload ?? {};
  const capturedPieceIds = readStringArray(payload.capturedPieceIds, sequence.action?.payload?.capturedPieceIds);
  if (capturedPieceIds.length) return capturedPieceIds.length;
  return payload.captured === true ? 1 : 0;
};

const normalizeSeat = (seat: GameStatisticsSeatSource, fallbackIndex: number): GameStatisticsSeat => ({
  id: readString(seat.id),
  label: readString(seat.label) || `P${fallbackIndex + 1}`,
  name: readString(seat.name, seat.label) || `플레이어 ${fallbackIndex + 1}`,
  seatIndex: Number.isFinite(Number(seat.seatIndex)) ? Number(seat.seatIndex) : fallbackIndex,
  isAI: Boolean(seat.isAI || seat.isSubstitutedByAI),
});

const readSeatsFromState = (state: unknown): readonly GameStatisticsSeatSource[] => {
  const stateObject = readObject(state);
  return Array.isArray(stateObject?.gameSeats)
    ? stateObject.gameSeats as GameStatisticsSeatSource[]
    : [];
};

export function resolveGameStatisticsSeats(
  latestState: GameStatisticsStateSource | null | undefined,
  sequences: readonly GameStatisticsSequence[],
): GameStatisticsSeat[] {
  const newestStateSeats = [...sequences]
    .sort((left, right) => Number(right.sequence) - Number(left.sequence))
    .map((sequence) => readSeatsFromState(sequence.stateAfter).length
      ? readSeatsFromState(sequence.stateAfter)
      : readSeatsFromState(sequence.stateBefore))
    .find((seats) => seats.length > 0);

  const sourceSeats = readSeatsFromState(latestState).length
    ? readSeatsFromState(latestState)
    : newestStateSeats ?? [];

  if (sourceSeats.length) {
    return sourceSeats
      .map(normalizeSeat)
      .filter((seat) => Boolean(seat.id))
      .sort((left, right) => left.seatIndex - right.seatIndex);
  }

  const actorIds = Array.from(new Set(sequences.map((sequence) => readString(sequence.actorId)).filter(Boolean)));
  return actorIds.map((id, index) => ({
    id,
    label: `P${index + 1}`,
    name: `플레이어 ${index + 1}`,
    seatIndex: index,
    isAI: false,
  }));
}

export function buildGameStatistics(
  sequences: readonly GameStatisticsSequence[],
  seats: readonly GameStatisticsSeat[],
): PlayerGameStatistics[] {
  return seats.map((seat) => {
    const rolls = sequences
      .filter((sequence) => sequence.type === 'roll_yut' && sequence.actorId === seat.id)
      .map((sequence) => ({
        sequence: Number(sequence.sequence) || 0,
        timing: normalizeTimingResult(sequence),
        result: normalizeYutResult(sequence),
      }))
      .sort((left, right) => right.sequence - left.sequence);

    const totalRolls = rolls.length;
    const capturedPieceCount = sequences
      .filter((sequence) => sequence.actorId === seat.id)
      .reduce((sum, sequence) => sum + getCapturedPieceCount(sequence), 0);

    return {
      seat,
      rolls,
      totalRolls,
      timing: makeBreakdown(TIMING_STAT_LABELS, rolls.map((roll) => roll.timing), totalRolls),
      yut: makeBreakdown(YUT_STAT_LABELS, rolls.map((roll) => roll.result), totalRolls),
      capturedPieceCount,
    };
  });
}
