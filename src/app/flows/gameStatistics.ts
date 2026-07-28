export const TIMING_STAT_LABELS = ['PERFECT', 'NICE', 'GOOD', 'BAD', '미확인'] as const;
export const YUT_STAT_LABELS = ['빽도', '도', '개', '걸', '윷', '모', '낙', '미확인'] as const;

export type TimingStatisticLabel = typeof TIMING_STAT_LABELS[number];
export type YutStatisticLabel = typeof YUT_STAT_LABELS[number];

export type GameStatisticsPlayerInput = {
  id: string;
  label: string;
  name: string;
};

export type GameStatisticsSequence = {
  sequence?: unknown;
  type?: unknown;
  actorId?: unknown;
  payload?: Record<string, unknown>;
  action?: { payload?: Record<string, unknown> } | null;
};

export type StatisticCount = {
  label: string;
  count: number;
  percentage: number;
};

export type PlayerRollStatisticRecord = {
  sequence: number;
  timing: TimingStatisticLabel;
  result: YutStatisticLabel;
};

export type PlayerGameStatistics = GameStatisticsPlayerInput & {
  totalRolls: number;
  captureCount: number;
  records: PlayerRollStatisticRecord[];
  timing: StatisticCount[];
  results: StatisticCount[];
};

const asObject = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const normalizeTiming = (value: unknown): TimingStatisticLabel => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'perfect') return 'PERFECT';
  if (normalized === 'nice') return 'NICE';
  if (normalized === 'good') return 'GOOD';
  if (normalized === 'bad' || normalized === 'normal') return 'BAD';
  return '미확인';
};

const normalizeYutResult = (value: unknown): YutStatisticLabel => {
  if (value === '빽도' || value === '도' || value === '개' || value === '걸' || value === '윷' || value === '모') return value;
  return '미확인';
};

const getRollTiming = (sequence: GameStatisticsSequence) => {
  const payload = sequence.payload ?? {};
  const actionPayload = sequence.action?.payload ?? {};
  return normalizeTiming(payload.timingZone ?? payload.rollTimingZone ?? actionPayload.rollTimingZone ?? actionPayload.timingZone);
};

const getRollResult = (sequence: GameStatisticsSequence): YutStatisticLabel => {
  const payload = sequence.payload ?? {};
  const actionPayload = sequence.action?.payload ?? {};
  if (payload.fallOccurred === true || actionPayload.clientFallOccurred === true) return '낙';

  const candidates = [
    asObject(payload.displayRoll)?.name,
    payload.rollName,
    asObject(actionPayload.selectedGoldenYutResult)?.name,
    asObject(actionPayload.clientRollResult)?.name,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeYutResult(candidate);
    if (normalized !== '미확인') return normalized;
  }
  return '미확인';
};

const getSequenceNumber = (sequence: GameStatisticsSequence) => {
  const value = Number(sequence.sequence ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const getCapturedPieceCount = (sequence: GameStatisticsSequence) => {
  if (sequence.type !== 'move_piece_resolved') return 0;
  const payload = sequence.payload ?? {};
  const capturedPieceIds = Array.isArray(payload.capturedPieceIds)
    ? Array.from(new Set(payload.capturedPieceIds.map(String).filter(Boolean)))
    : [];
  if (capturedPieceIds.length) return capturedPieceIds.length;
  return payload.captured === true ? 1 : 0;
};

const toCountRows = (labels: readonly string[], values: string[], total: number): StatisticCount[] => labels.map((label) => {
  const count = values.filter((value) => value === label).length;
  const percentage = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
  return { label, count, percentage };
});

export const formatStatisticPercentage = (value: number) => (
  Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`
);

export function createGameStatistics(
  sequences: readonly GameStatisticsSequence[],
  players: readonly GameStatisticsPlayerInput[],
): PlayerGameStatistics[] {
  return players.map((player) => {
    const records = sequences
      .filter((sequence) => sequence.type === 'roll_yut' && sequence.actorId === player.id)
      .map((sequence) => ({
        sequence: getSequenceNumber(sequence),
        timing: getRollTiming(sequence),
        result: getRollResult(sequence),
      }))
      .sort((left, right) => right.sequence - left.sequence);
    const totalRolls = records.length;
    const captureCount = sequences
      .filter((sequence) => sequence.actorId === player.id)
      .reduce((total, sequence) => total + getCapturedPieceCount(sequence), 0);

    return {
      ...player,
      totalRolls,
      captureCount,
      records,
      timing: toCountRows(TIMING_STAT_LABELS, records.map((record) => record.timing), totalRolls),
      results: toCountRows(YUT_STAT_LABELS, records.map((record) => record.result), totalRolls),
    };
  });
}
