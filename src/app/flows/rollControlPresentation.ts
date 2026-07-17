export type RollControlPresentationInput = {
  hasRoll: boolean;
  canRollNow: boolean;
  showRollStackPicker: boolean;
  timedOut: boolean;
};

export type GameControlsAutoScrollInput = {
  hasRoll: boolean;
  canRollNow: boolean;
  canRollForTurnOrderNow: boolean;
  hasActiveTurnOrderIntro: boolean;
  showBottomBranchControls: boolean;
  canRequestMove: boolean;
};

export function shouldAutoScrollGameControls({
  hasRoll,
  canRollNow,
  canRollForTurnOrderNow,
  hasActiveTurnOrderIntro,
  showBottomBranchControls,
  canRequestMove,
}: GameControlsAutoScrollInput) {
  const rollControlReady = !hasRoll && (canRollNow || canRollForTurnOrderNow || hasActiveTurnOrderIntro);
  const branchMoveReady = showBottomBranchControls && canRequestMove;
  return rollControlReady || branchMoveReady;
}

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
