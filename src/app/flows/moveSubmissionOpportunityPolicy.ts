export type AutoMoveOpportunity = {
  key: string;
  readyAt: number;
  submitted: boolean;
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

export function markAutoMoveSubmitted(current: AutoMoveOpportunity | null, key: string) {
  if (current?.key === key) current.submitted = true;
}
