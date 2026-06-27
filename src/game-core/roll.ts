export type YutResultName = '빽도' | '도' | '개' | '걸' | '윷' | '모' | '황금 윷';
export type YutResult = { name: YutResultName; steps: number; bonus?: boolean };
export type YutStick = { flat: boolean; marked: boolean };

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

export function makeDisplaySticks(result: YutResult): YutStick[] {
  if (result.name === '모') return Array.from({ length: 4 }, (_, index) => ({ flat: false, marked: index === 0 }));
  if (result.name === '빽도') return Array.from({ length: 4 }, (_, index) => ({ flat: index === 0, marked: index === 0 }));
  const flatCount = Math.max(0, Math.min(4, result.steps));
  return Array.from({ length: 4 }, (_, index) => ({ flat: index < flatCount, marked: index === 0 }));
}
