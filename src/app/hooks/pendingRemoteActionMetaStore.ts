export type PendingRemoteActionMetaLike = {
  optimisticApplied?: boolean;
};

const MAX_ACKNOWLEDGED_OPTIMISTIC_ACTIONS = 160;

/**
 * Pending actions and already-presented optimistic actions have different lifetimes.
 * Map iteration and size expose only actions that are still waiting for the server,
 * while get() also keeps a bounded replay-deduplication history after acknowledgement.
 */
export class PendingRemoteActionMetaStore<Meta extends PendingRemoteActionMetaLike> extends Map<string, Meta> {
  private readonly acknowledgedOptimisticActions = new Map<string, Meta>();

  override get(actionKey: string) {
    return super.get(actionKey) ?? this.acknowledgedOptimisticActions.get(actionKey);
  }

  override set(actionKey: string, meta: Meta) {
    this.acknowledgedOptimisticActions.delete(actionKey);
    return super.set(actionKey, meta);
  }

  override delete(actionKey: string) {
    const deletedPending = super.delete(actionKey);
    const deletedAcknowledged = this.acknowledgedOptimisticActions.delete(actionKey);
    return deletedPending || deletedAcknowledged;
  }

  override clear() {
    super.clear();
    this.acknowledgedOptimisticActions.clear();
  }

  acknowledge(actionKey: string) {
    const meta = super.get(actionKey);
    if (!meta) return false;
    super.delete(actionKey);
    if (!meta.optimisticApplied) {
      this.acknowledgedOptimisticActions.delete(actionKey);
      return true;
    }

    this.acknowledgedOptimisticActions.delete(actionKey);
    this.acknowledgedOptimisticActions.set(actionKey, meta);
    while (this.acknowledgedOptimisticActions.size > MAX_ACKNOWLEDGED_OPTIMISTIC_ACTIONS) {
      const oldestActionKey = this.acknowledgedOptimisticActions.keys().next().value;
      if (typeof oldestActionKey !== 'string') break;
      this.acknowledgedOptimisticActions.delete(oldestActionKey);
    }
    return true;
  }
}
