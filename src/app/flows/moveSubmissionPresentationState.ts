let moveSubmissionPending = false;

export function publishMoveSubmissionPending(nextPending: boolean) {
  moveSubmissionPending = nextPending;
}

export function getMoveSubmissionPendingSnapshot() {
  return moveSubmissionPending;
}
