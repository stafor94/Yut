type StackedMoveDeadlinePatch = {
  rollStack?: unknown;
  rollStackClosed?: unknown;
  turnDeadlineKind?: unknown;
};

type StackedMoveDeadlineContext = {
  stackedRollMode: boolean;
  captured: boolean;
};

/**
 * A committed stacked move that leaves another closed stack entry is still in
 * the move stage. The base move reducer may prepare the next roll deadline,
 * so normalize only this authoritative intermediate state back to `move`.
 */
export const preserveRemainingStackMoveDeadline = <T extends StackedMoveDeadlinePatch>(
  patch: T,
  { stackedRollMode, captured }: StackedMoveDeadlineContext,
): T => {
  if (
    !stackedRollMode
    || captured
    || !Array.isArray(patch.rollStack)
    || patch.rollStack.length === 0
    || patch.rollStackClosed !== true
  ) {
    return patch;
  }

  return {
    ...patch,
    turnDeadlineKind: 'move',
  } as T;
};
