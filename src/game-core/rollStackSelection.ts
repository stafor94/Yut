import type { YutResult } from './roll';

export type RollStackSelectionParams = {
  rollStack: YutResult[];
  hasBackDoMovablePiece: boolean;
};

const isBackDoRoll = (roll: YutResult) => roll.name === '빽도';

export const getRollStackSelectionAvailability = ({
  rollStack,
  hasBackDoMovablePiece,
}: RollStackSelectionParams): boolean[] => {
  const hasBackDo = rollStack.some(isBackDoRoll);
  const hasNonBackDo = rollStack.some((roll) => !isBackDoRoll(roll));
  const disableBackDo = rollStack.length >= 2
    && hasBackDo
    && hasNonBackDo
    && !hasBackDoMovablePiece;

  return rollStack.map((roll) => !(disableBackDo && isBackDoRoll(roll)));
};

export const isRollStackIndexSelectable = (
  availability: readonly boolean[],
  index: number,
): boolean => Number.isInteger(index)
  && index >= 0
  && index < availability.length
  && availability[index] === true;

export const findFirstSelectableRollStackIndex = (
  availability: readonly boolean[],
): number | null => {
  const index = availability.findIndex(Boolean);
  return index >= 0 ? index : null;
};
