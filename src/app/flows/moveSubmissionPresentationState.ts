let moveSubmissionPending = false;

export function publishMoveSubmissionPending(nextPending: boolean) {
  moveSubmissionPending = nextPending;
}

export function getMoveSubmissionPendingSnapshot() {
  return moveSubmissionPending;
}

export function shouldHidePendingFinalRollStackPresentation(params: {
  stackedRollMode: boolean;
  authoritativeRollStackLength: number;
  rollStackClosed: boolean;
  moveSubmissionPending: boolean;
  movementStarted: boolean;
  isLocalTurn: boolean;
}) {
  return Boolean(
    params.stackedRollMode
    && params.authoritativeRollStackLength === 1
    && params.rollStackClosed
    && params.moveSubmissionPending
    && params.movementStarted
    && params.isLocalTurn
  );
}
