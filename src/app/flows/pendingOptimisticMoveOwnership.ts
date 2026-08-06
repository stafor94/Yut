export type PendingOptimisticMoveAction = {
  actionKey: string;
  actorId: string;
  createdAt: number;
};

const pendingOptimisticMoveActions = new Map<string, PendingOptimisticMoveAction>();

export const rememberPendingOptimisticMoveAction = (action: PendingOptimisticMoveAction) => {
  if (!action.actionKey || !action.actorId || !Number.isFinite(action.createdAt) || action.createdAt <= 0) return false;
  pendingOptimisticMoveActions.set(action.actionKey, action);
  return true;
};

export const forgetPendingOptimisticMoveAction = (actionKey: string) => (
  pendingOptimisticMoveActions.delete(actionKey)
);

export const clearPendingOptimisticMoveActions = () => {
  pendingOptimisticMoveActions.clear();
};

export const getPendingOptimisticMoveAction = (actorId: string) => {
  if (!actorId) return undefined;
  let latest: PendingOptimisticMoveAction | undefined;
  for (const action of pendingOptimisticMoveActions.values()) {
    if (action.actorId !== actorId || (latest && latest.createdAt >= action.createdAt)) continue;
    latest = action;
  }
  return latest ? { ...latest } : undefined;
};
