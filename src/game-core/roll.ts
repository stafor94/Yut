import { getCurrentAiRollDifficulty, type AiDifficulty } from './aiDifficulty';

export type YutResultName = '빽도' | '도' | '개' | '걸' | '윷' | '모' | '황금 윷';
export type YutResult = { name: YutResultName; steps: number; bonus?: boolean };
export type YutStick = { flat: boolean; marked: boolean };
export type RollTimingZone = 'perfect' | 'good' | 'normal';

export const STANDARD_YUT_RESULTS: YutResult[] = [
  { name: '도', steps: 1 },
  { name: '개', steps: 2 },
  { name: '걸', steps: 3 },
  { name: '윷', steps: 4, bonus: true },
  { name: '모', steps: 5, bonus: true },
];

export const GOLDEN_YUT_CHOICES: YutResult[] = [{ name: '빽도', steps: -1 }, ...STANDARD_YUT_RESULTS];

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

export function getRollTimingPositionPercent(elapsedMs: number) {
  const cycleMs = 1000;
  const halfCycleMs = cycleMs / 2;
  const cyclePosition = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  const ratio = cyclePosition <= halfCycleMs ? cyclePosition / halfCycleMs : (cycleMs - cyclePosition) / halfCycleMs;
  return Math.max(0, Math.min(100, ratio * 100));
}

export function getRollTimingZone(positionPercent: number): RollTimingZone {
  if (positionPercent >= 45 && positionPercent <= 55) return 'perfect';
  if ((positionPercent >= 35 && positionPercent < 45) || (positionPercent > 55 && positionPercent <= 65)) return 'good';
  return 'normal';
}

export function getFallChanceForTimingZone(zone: RollTimingZone) {
  if (zone === 'perfect') return 0;
  if (zone === 'good') return 0.1;
  return 0.4;
}

export function shouldFallForTimingZone(zone: RollTimingZone, random = Math.random) {
  return random() < getFallChanceForTimingZone(zone);
}

export function chooseAiRollTimingZone(random?: () => number): RollTimingZone;
export function chooseAiRollTimingZone(difficulty: AiDifficulty, random?: () => number): RollTimingZone;
export function chooseAiRollTimingZone(difficultyOrRandom?: AiDifficulty | (() => number), providedRandom = Math.random): RollTimingZone {
  const difficulty = typeof difficultyOrRandom === 'string' ? difficultyOrRandom : getCurrentAiRollDifficulty();
  const random = typeof difficultyOrRandom === 'function' ? difficultyOrRandom : providedRandom;
  const roll = random();
  const perfectChance = difficulty === 'easy' ? 0.2 : 0.3;
  if (roll < perfectChance) return 'perfect';
  if (roll < perfectChance + 0.4) return 'good';
  return 'normal';
}

export function rollYutResultWithTiming(zone: RollTimingZone = 'normal', random = Math.random, useBackDo = true) {
  if (zone !== 'perfect') return rollYutResult(random, useBackDo);
  const resultRoll = random();
  const backDoChance = useBackDo ? 0.0625 : 0;
  const baseWeights = [
    { result: { name: '빽도', steps: -1 } as YutResult, weight: backDoChance },
    { result: { name: '도', steps: 1 } as YutResult, weight: 0.25 - backDoChance },
    { result: { name: '개', steps: 2 } as YutResult, weight: 0.375 },
    { result: { name: '걸', steps: 3 } as YutResult, weight: 0.25 },
  ];
  const nonBonusBaseTotal = baseWeights.reduce((sum, entry) => sum + entry.weight, 0);
  const nonBonusTargetTotal = Math.max(0, nonBonusBaseTotal - 0.1);
  const weights = [
    ...baseWeights.map((entry) => ({ ...entry, weight: entry.weight * (nonBonusTargetTotal / nonBonusBaseTotal) })),
    { result: { name: '윷', steps: 4, bonus: true } as YutResult, weight: 0.0625 + 0.05 },
    { result: { name: '모', steps: 5, bonus: true } as YutResult, weight: 0.0625 + 0.05 },
  ];
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
