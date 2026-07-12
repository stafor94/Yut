import type { YutResultName } from '../../game-core/roll';

export type SpokenYutResult = Exclude<YutResultName, '황금 윷'> | '낙';

const SPOKEN_YUT_RESULTS = new Set<SpokenYutResult>(['도', '개', '걸', '윷', '모', '빽도', '낙']);

export const normalizeSpokenYutResult = (value: string): SpokenYutResult | null => {
  const normalized = value.trim().replace(/[!！]+$/u, '');
  return SPOKEN_YUT_RESULTS.has(normalized as SpokenYutResult) ? normalized as SpokenYutResult : null;
};
