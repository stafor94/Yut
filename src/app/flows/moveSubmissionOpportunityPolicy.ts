export type AutoMoveOpportunity = {
  key: string;
  readyAt: number;
  submitted: boolean;
};

export type MoveSubmissionPresentationState = {
  key: string;
  sawRequestBlocked: boolean;
};

export function getOrCreateAutoMoveOpportunity(
  current: AutoMoveOpportunity | null,
  key: string,
  now: number,
  delayMs: number,
): AutoMoveOpportunity | null {
  if (!key) return null;
  if (current?.key === key) return current;
  return {
    key,
    readyAt: now + Math.max(0, delayMs),
    submitted: false,
  };
}

export function shouldAttemptAutoMove({
  opportunity,
  key,
  now,
  moveRequestReady,
  moveActionReady,
  submissionPending,
}: {
  opportunity: AutoMoveOpportunity | null;
  key: string;
  now: number;
  moveRequestReady: boolean;
  moveActionReady: boolean;
  submissionPending: boolean;
}) {
  return Boolean(
    opportunity
    && opportunity.key === key
    && !opportunity.submitted
    && !submissionPending
    && moveRequestReady
    && moveActionReady
    && now >= opportunity.readyAt,
  );
}

export function beginMoveSubmissionPresentation(key: string): MoveSubmissionPresentationState | null {
  return key ? { key, sawRequestBlocked: false } : null;
}

export function reconcileMoveSubmissionPresentation(
  current: MoveSubmissionPresentationState | null,
  {
    currentKey,
    isMyTurn,
    moveRequestReady,
    movingPieceActive,
  }: {
    currentKey: string;
    isMyTurn: boolean;
    moveRequestReady: boolean;
    movingPieceActive: boolean;
  },
): MoveSubmissionPresentationState | null {
  if (!current) return null;
  if (!currentKey || current.key !== currentKey || !isMyTurn) return null;
  if (!moveRequestReady) {
    return current.sawRequestBlocked ? current : { ...current, sawRequestBlocked: true };
  }
  if (current.sawRequestBlocked && !movingPieceActive) return null;
  return current;
}
