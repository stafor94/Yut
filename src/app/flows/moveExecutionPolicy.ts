export function shouldExecuteScheduledMove({
  canRequestMove,
  scheduledContextKey,
  latestContextKey,
}: {
  canRequestMove: boolean;
  scheduledContextKey: string;
  latestContextKey: string;
}) {
  return canRequestMove
    && Boolean(scheduledContextKey)
    && scheduledContextKey === latestContextKey;
}

export function claimMoveActionOnce(actionKey: string, requestedActionKeys: Set<string>) {
  if (!actionKey || requestedActionKeys.has(actionKey)) return false;
  requestedActionKeys.add(actionKey);
  return true;
}
