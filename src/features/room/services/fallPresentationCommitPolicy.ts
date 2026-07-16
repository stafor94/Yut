import type { CommitAuthoritativeGameActionResult, GameAction } from './roomServiceCore';

type CommittableGameAction = Omit<GameAction, 'id' | 'createdAt' | 'processed'>;

export const isFallPresentationCompletionAction = (action: CommittableGameAction) => (
  action.type === 'roll_yut' && action.payload?.completeFallPresentation === true
);

export const shouldWaitForGamePresentationBeforeCommit = (action: CommittableGameAction) => (
  !isFallPresentationCompletionAction(action)
);

export const shouldRetryFallPresentationCompletion = (
  action: CommittableGameAction,
  result: Pick<CommitAuthoritativeGameActionResult, 'status'>,
) => isFallPresentationCompletionAction(action)
  && result.status !== 'committed'
  && result.status !== 'duplicate';
