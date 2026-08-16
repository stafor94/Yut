export type AutoMoveOpportunity = {
  key: string;
  readyAt: number;
  submitted: boolean;
};

export function getOrCreateAutoMoveOpportunity(
  current: AutoMoveOpportunity | null,
  key: string,
  now: number,
  canStart: boolean,
): AutoMoveOpportunity | null {
  if (!key) return null;
  if (current?.key === key) return current;
  if (!canStart) return null;
  return {
    key,
    readyAt: now,
    submitted: false,
  };
}

export function shouldAttemptAutoMove({
  opportunity,
  key,
  now,
  moveRequestReady,
  moveActionReady,
  transitionActionReady,
  submissionPending,
}: {
  opportunity: AutoMoveOpportunity | null;
  key: string;
  now: number;
  moveRequestReady: boolean;
  moveActionReady: boolean;
  transitionActionReady: boolean;
  submissionPending: boolean;
}) {
  return Boolean(
    opportunity
    && opportunity.key === key
    && !opportunity.submitted
    && !submissionPending
    && moveRequestReady
    && moveActionReady
    && transitionActionReady
    && now >= opportunity.readyAt,
  );
}

export function markAutoMoveSubmitted(current: AutoMoveOpportunity | null, key: string) {
  if (current?.key === key) current.submitted = true;
}
