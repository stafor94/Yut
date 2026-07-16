type CommittableGameAction = {
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
};

type ActionResultSummary = {
  status: string;
};

export const FALL_PRESENTATION_COMMIT_RETRY_MS = 800;
export const FALL_PRESENTATION_COMMIT_MAX_ATTEMPTS = 6;

export const isFallPresentationCompletionAction = (action: CommittableGameAction) => (
  action.type === 'roll_yut' && action.payload?.completeFallPresentation === true
);

export const resolveFallPresentationCompletionLocally = (action: CommittableGameAction) => (
  isFallPresentationCompletionAction(action) ? { status: 'duplicate' as const } : null
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

export async function settleFallPresentationCompletionWithRetry<TResult extends ActionResultSummary>({
  action,
  commit,
  wait = (delayMs) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)),
  retryDelayMs = FALL_PRESENTATION_COMMIT_RETRY_MS,
  maxAttempts = FALL_PRESENTATION_COMMIT_MAX_ATTEMPTS,
}: {
  action: CommittableGameAction;
  commit: () => Promise<TResult>;
  wait?: (delayMs: number) => Promise<void>;
  retryDelayMs?: number;
  maxAttempts?: number;
}): Promise<TResult> {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  let result = await commit();

  for (let attempt = 1; attempt < attempts && shouldRetryFallPresentationCompletion(action, result); attempt += 1) {
    await wait(Math.max(0, retryDelayMs));
    result = await commit();
  }

  return result;
}
