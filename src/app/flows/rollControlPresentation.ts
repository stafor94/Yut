export type RollControlPresentationInput = {
  hasRoll: boolean;
  canRollNow: boolean;
  showRollStackPicker: boolean;
};

export function getRollControlPresentation({
  hasRoll,
  canRollNow,
  showRollStackPicker,
}: RollControlPresentationInput) {
  const canStartRoll = !hasRoll && canRollNow;
  return {
    showTimingMeter: canStartRoll && !showRollStackPicker,
    actionButtonTestId: hasRoll
      ? 'move-piece-button'
      : canStartRoll
        ? 'roll-yut-button'
        : 'turn-waiting-button',
  } as const;
}
