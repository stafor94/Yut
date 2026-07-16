type CommittableGameAction = {
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
};

type ActionResultSummary = {
  status: string;
};

export const isFallPresentationCompletionAction = (action: CommittableGameAction) => (
  action.type === 'roll_yut' && action.payload?.completeFallPresentation === true
);

export const shouldWaitForGamePresentationBeforeCommit = (action: CommittableGameAction) => (
  !isFallPresentationCompletionAction(action)
);

export const shouldRetryFallPresentationCompletion = (
  action: CommittableGameAction,
  result: ActionResultSummary,
) => isFallPresentationCompletionAction(action)
  && result.status !== 'committed'
  && result.status !== 'duplicate';
