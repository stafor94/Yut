export type RollControlPresentationInput = {
  hasRoll: boolean;
  canRollNow: boolean;
  showRollStackPicker: boolean;
  timedOut: boolean;
};

export function getRollControlPresentation({
  hasRoll,
  canRollNow,
  showRollStackPicker,
  timedOut,
}: RollControlPresentationInput) {
  const canStartRoll = !hasRoll && canRollNow && !timedOut;
  return {
    showTimingMeter: canStartRoll && !showRollStackPicker,
    actionButtonTestId: timedOut
      ? 'turn-waiting-button'
      : hasRoll
        ? 'move-piece-button'
        : canStartRoll
          ? 'roll-yut-button'
          : 'turn-waiting-button',
  } as const;
}
