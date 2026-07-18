import type { YutResult } from '../../game-core/roll';

export type EffectiveMoveContext = {
  roll: YutResult | null;
  rollStackIndex: number | null;
  steps: number;
  fromStack: boolean;
};

export function resolveEffectiveMoveContext(params: {
  stackedRollMode: boolean;
  roll: YutResult | null;
  rollStack: YutResult[];
  rollStackClosed: boolean;
  selectedRollStackIndex: number | null;
  rollStackIndexOverride?: number | null;
}): EffectiveMoveContext {
  const {
    stackedRollMode,
    roll,
    rollStack,
    rollStackClosed,
    selectedRollStackIndex,
    rollStackIndexOverride,
  } = params;

  if (!stackedRollMode || !rollStackClosed || !rollStack.length) {
    return { roll, rollStackIndex: null, steps: roll?.steps ?? 0, fromStack: false };
  }

  const requestedIndex = typeof rollStackIndexOverride === 'number'
    ? rollStackIndexOverride
    : typeof selectedRollStackIndex === 'number'
      ? selectedRollStackIndex
      : rollStack.length === 1
        ? 0
        : null;
  const validIndex = requestedIndex !== null && requestedIndex >= 0 && requestedIndex < rollStack.length
    ? requestedIndex
    : null;
  const effectiveRoll = validIndex === null ? null : rollStack[validIndex] ?? null;
  return {
    roll: effectiveRoll,
    rollStackIndex: validIndex,
    steps: effectiveRoll?.steps ?? 0,
    fromStack: true,
  };
}
