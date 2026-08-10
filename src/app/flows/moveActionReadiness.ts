export type MoveActionReadinessInput = {
  canSubmitTurnAction: boolean;
  rollPresentationBlocked: boolean;
  hasPendingMoveAction: boolean;
  hasValidMoveSelection: boolean;
  rollResultHolding: boolean;
  rollAnimationActive: boolean;
  moveInProgress: boolean;
  movingPieceActive: boolean;
};

export type MoveActionSubmissionOptions = {
  deadlineAutoSubmitted?: boolean;
  autoSubmittedDeadlineAt?: number;
  clientActionStartedAt?: number;
  rollStackIndex?: number;
};

export function getMoveActionReady({
  canSubmitTurnAction,
  rollPresentationBlocked,
  hasPendingMoveAction,
  hasValidMoveSelection,
  rollResultHolding,
  rollAnimationActive,
  moveInProgress,
  movingPieceActive,
}: MoveActionReadinessInput) {
  return Boolean(
    canSubmitTurnAction
    && !rollPresentationBlocked
    && !hasPendingMoveAction
    && hasValidMoveSelection
    && !rollResultHolding
    && !rollAnimationActive
    && !moveInProgress
    && !movingPieceActive
  );
}
