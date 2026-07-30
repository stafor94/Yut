import { getCurrentAiRollDifficulty, type AiDifficulty } from './aiDifficulty';

export type YutResultName = '빽도' | '도' | '개' | '걸' | '윷' | '모' | '황금 윷';
export type YutResult = { name: YutResultName; steps: number; bonus?: boolean };
export type YutStick = { flat: boolean; marked: boolean };
export type RollTimingGrade = 'perfect' | 'nice' | 'good' | 'bad';
/** `normal` is accepted only while older clients and saved sequences are being upgraded. */
export type RollTimingZone = RollTimingGrade | 'normal';
export type RollFallCountRange = readonly [min: number, max: number];

export const isRollTimingZone = (value: unknown): value is RollTimingZone => (
  value === 'perfect' || value === 'nice' || value === 'good' || value === 'bad' || value === 'normal'
);

export const normalizeRollTimingZone = (zone: RollTimingZone): RollTimingGrade => zone === 'normal' ? 'bad' : zone;

export const getRollFallCountRange = (zone: RollTimingZone): RollFallCountRange => {
  if (zone === 'nice') return [1, 1];
  if (zone === 'good') return [1, 2];
  if (zone === 'bad') return [2, 4];
  // Perfect cannot normally fall, while legacy Normal and malformed historic
  // Perfect payloads keep the previous 1~4 compatibility contract.
  return [1, 4];
};

const clampRandomUnit = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
};

export function getRollFallCountForTimingZone(zone: RollTimingZone, random = Math.random) {
  // Current clients submit a legacy 1~4 raw value. Generate through the same
  // raw contract before normalization so user, AI, and automatic actions have
  // one deterministic distribution while older clients remain compatible.
  const rawFallCount = Math.floor(clampRandomUnit(random()) * 4) + 1;
  return normalizeRollFallCount(zone, rawFallCount);
}

export function normalizeRollFallCount(zone: RollTimingZone, value: unknown) {
  const [min, max] = getRollFallCountRange(zone);
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(max, Math.max(min, Math.trunc(numericValue)));
}

export const STANDARD_YUT_RESULTS: YutResult[] = [
  { name: '도', steps: 1 },
  { name: '개', steps: 2 },
  { name: '걸', steps: 3 },
  { name: '윷', steps: 4, bonus: true },
  { name: '모', steps: 5, bonus: true },
];

export const GOLDEN_YUT_CHOICES: YutResult[] = [{ name: '빽도', steps: -1 }, ...STANDARD_YUT_RESULTS];

export type YutResultProbability = {
  name: Exclude<YutResultName, '황금 윷'>;
  probability: number;
};

export function getYutResultProbabilitiesForTiming(zone: RollTimingZone = 'bad', useBackDo = true): YutResultProbability[] {
  const backDoChance = useBackDo ? 0.0625 : 0;
  const baseProbabilities: YutResultProbability[] = [
    { name: '빽도', probability: backDoChance },
    { name: '도', probability: 0.25 - backDoChance },
    { name: '개', probability: 0.375 },
    { name: '걸', probability: 0.25 },
    { name: '윷', probability: 0.0625 },
    { name: '모', probability: 0.0625 },
  ];
  if (normalizeRollTimingZone(zone) !== 'perfect') return baseProbabilities;

  const bonusBoost = 0.05;
  const nonBonusBaseTotal = baseProbabilities
    .filter(({ name }) => name !== '윷' && name !== '모')
    .reduce((sum, entry) => sum + entry.probability, 0);
  const nonBonusTargetTotal = Math.max(0, nonBonusBaseTotal - bonusBoost * 2);
  return baseProbabilities.map((entry) => ({
    ...entry,
    probability: entry.name === '윷' || entry.name === '모'
      ? entry.probability + bonusBoost
      : entry.probability * (nonBonusTargetTotal / nonBonusBaseTotal),
  }));
}

export function rollYutSticks(random = Math.random): YutStick[] {
  return Array.from({ length: 4 }, (_, index) => ({ flat: random() < 0.5, marked: index === 0 }));
}

export function getYutResultFromSticks(sticks: YutStick[], useBackDo = true): YutResult {
  const flatCount = sticks.filter((stick) => stick.flat).length;
  if (flatCount === 0) return { name: '모', steps: 5, bonus: true };
  if (flatCount === 1) {
    const flatStick = sticks.find((stick) => stick.flat);
    if (useBackDo && flatStick?.marked) return { name: '빽도', steps: -1 };
    return { name: '도', steps: 1 };
  }
  if (flatCount === 2) return { name: '개', steps: 2 };
  if (flatCount === 3) return { name: '걸', steps: 3 };
  return { name: '윷', steps: 4, bonus: true };
}

export function rollYutResult(random = Math.random, useBackDo = true) {
  const sticks = rollYutSticks(random);
  return { sticks, result: getYutResultFromSticks(sticks, useBackDo) };
}

/** The visible timing orb takes 1 second per direction, so a full round trip is 2 seconds. */
export function getRollTimingPositionPercent(elapsedMs: number) {
  const cycleMs = 2000;
  const halfCycleMs = cycleMs / 2;
  const cyclePosition = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  const ratio = cyclePosition <= halfCycleMs ? cyclePosition / halfCycleMs : (cycleMs - cyclePosition) / halfCycleMs;
  return Math.max(0, Math.min(100, ratio * 100));
}

export function getRollTimingZone(positionPercent: number): RollTimingGrade {
  if (positionPercent >= 45 && positionPercent <= 55) return 'perfect';
  if ((positionPercent >= 40 && positionPercent < 45) || (positionPercent > 55 && positionPercent <= 60)) return 'nice';
  if ((positionPercent >= 20 && positionPercent < 40) || (positionPercent > 60 && positionPercent <= 80)) return 'good';
  return 'bad';
}

export function getFallChanceForTimingZone(zone: RollTimingZone) {
  const grade = normalizeRollTimingZone(zone);
  if (grade === 'perfect') return 0;
  if (grade === 'nice') return 0.05;
  if (grade === 'good') return 0.2;
  return 0.7;
}

export function shouldFallForTimingZone(zone: RollTimingZone, random = Math.random) {
  return random() < getFallChanceForTimingZone(zone);
}

export function chooseAiRollTimingZone(random?: () => number): RollTimingGrade;
export function chooseAiRollTimingZone(difficulty: AiDifficulty, random?: () => number): RollTimingGrade;
export function chooseAiRollTimingZone(difficultyOrRandom?: AiDifficulty | (() => number), providedRandom = Math.random): RollTimingGrade {
  const difficulty = typeof difficultyOrRandom === 'string' ? difficultyOrRandom : getCurrentAiRollDifficulty();
  const random = typeof difficultyOrRandom === 'function' ? difficultyOrRandom : providedRandom;
  const roll = random();
  if (difficulty === 'easy') {
    if (roll < 0.1) return 'perfect';
    if (roll < 0.3) return 'nice';
    if (roll < 0.8) return 'good';
    return 'bad';
  }
  if (roll < 0.6) return 'perfect';
  if (roll < 0.85) return 'nice';
  if (roll < 0.95) return 'good';
  return 'bad';
}

export function rollYutResultWithTiming(zone: RollTimingZone = 'bad', random = Math.random, useBackDo = true) {
  if (normalizeRollTimingZone(zone) !== 'perfect') return rollYutResult(random, useBackDo);
  const resultRoll = random();
  const weights = getYutResultProbabilitiesForTiming(zone, useBackDo).map(({ name, probability }) => ({
    result: GOLDEN_YUT_CHOICES.find((choice) => choice.name === name) as YutResult,
    weight: probability,
  }));
  let cursor = 0;
  const result = weights.find((entry) => {
    cursor += entry.weight;
    return resultRoll < cursor;
  })?.result ?? weights[weights.length - 1].result;
  return { sticks: makeDisplaySticks(result), result };
}

export function makeDisplaySticks(result: YutResult): YutStick[] {
  if (result.name === '모') return Array.from({ length: 4 }, (_, index) => ({ flat: false, marked: index === 0 }));
  if (result.name === '빽도') return Array.from({ length: 4 }, (_, index) => ({ flat: index === 0, marked: index === 0 }));
  if (result.name === '도') return Array.from({ length: 4 }, (_, index) => ({ flat: index === 1, marked: index === 0 }));
  const flatCount = Math.max(0, Math.min(4, result.steps));
  return Array.from({ length: 4 }, (_, index) => ({ flat: index < flatCount, marked: index === 0 }));
}
