export type LocalMovePresentationPhase = 'idle' | 'pending' | 'presenting';

export type LocalMovePresentationSnapshot = {
  generation: number;
  actionKey: string;
  pieceId: string;
  phase: LocalMovePresentationPhase;
};

export class LocalMovePresentationLifecycle {
  private snapshotValue: LocalMovePresentationSnapshot = {
    generation: 0,
    actionKey: '',
    pieceId: '',
    phase: 'idle',
  };

  private settlementPromise: Promise<void> = Promise.resolve();
  private resolveSettlement: (() => void) | null = null;

  begin(actionKey: string) {
    if (!actionKey) return this.snapshotValue.generation;
    if (this.snapshotValue.phase !== 'idle' && this.snapshotValue.actionKey === actionKey) {
      return this.snapshotValue.generation;
    }
    this.finishCurrent();
    const generation = this.snapshotValue.generation + 1;
    this.snapshotValue = {
      generation,
      actionKey,
      pieceId: '',
      phase: 'pending',
    };
    this.settlementPromise = new Promise<void>((resolve) => {
      this.resolveSettlement = resolve;
    });
    return generation;
  }

  observe(pieceId: string) {
    if (!pieceId || this.snapshotValue.phase === 'idle') return false;
    this.snapshotValue = {
      ...this.snapshotValue,
      pieceId,
      phase: 'presenting',
    };
    return true;
  }

  settle(pieceId = '') {
    if (this.snapshotValue.phase !== 'presenting') return false;
    if (pieceId && this.snapshotValue.pieceId && pieceId !== this.snapshotValue.pieceId) return false;
    this.finishCurrent();
    return true;
  }

  cancel() {
    if (this.snapshotValue.phase === 'idle') return false;
    this.finishCurrent();
    return true;
  }

  isActive() {
    return this.snapshotValue.phase !== 'idle';
  }

  snapshot() {
    return { ...this.snapshotValue };
  }

  waitForSettlement() {
    return this.settlementPromise;
  }

  private finishCurrent() {
    const resolve = this.resolveSettlement;
    this.resolveSettlement = null;
    this.snapshotValue = {
      generation: this.snapshotValue.generation,
      actionKey: '',
      pieceId: '',
      phase: 'idle',
    };
    this.settlementPromise = Promise.resolve();
    resolve?.();
  }
}

export const localMovePresentationLifecycle = new LocalMovePresentationLifecycle();

export const shouldBeginLocalMovePresentation = ({
  actionKey,
  actionType,
  optimisticApplied,
}: {
  actionKey: string;
  actionType: string;
  optimisticApplied: boolean;
}) => actionKey.startsWith('move_piece:') && actionType === 'move_piece' && optimisticApplied;

export const beginLocalMovePresentationForPendingAction = ({
  lifecycle,
  actionKey,
  actionType,
  optimisticApplied,
}: {
  lifecycle: LocalMovePresentationLifecycle;
  actionKey: string;
  actionType: string;
  optimisticApplied: boolean;
}) => {
  if (!shouldBeginLocalMovePresentation({ actionKey, actionType, optimisticApplied })) return false;
  lifecycle.begin(actionKey);
  return true;
};

type LocalMoveActionRecord = {
  type?: unknown;
  payload?: unknown;
};

const getLocalMovePresentationActionKey = (action: unknown) => {
  if (!action || typeof action !== 'object') return '';
  const actionRecord = action as LocalMoveActionRecord;
  if (actionRecord.type !== 'move_piece' || !actionRecord.payload || typeof actionRecord.payload !== 'object') return '';
  const payload = actionRecord.payload as Record<string, unknown>;
  const pieceId = typeof payload.pieceId === 'string' ? payload.pieceId : '';
  const clientActionId = typeof payload.clientActionId === 'string' ? payload.clientActionId : '';
  return pieceId && clientActionId ? clientActionId : '';
};

export async function waitForLocalMoveActionPresentation(
  action: unknown,
  lifecycle: LocalMovePresentationLifecycle = localMovePresentationLifecycle,
) {
  const actionKey = getLocalMovePresentationActionKey(action);
  if (!actionKey) return false;
  const snapshot = lifecycle.snapshot();
  if (snapshot.phase === 'idle' || snapshot.actionKey !== actionKey) return false;
  await lifecycle.waitForSettlement();
  return true;
}

export const shouldDeferAuthoritativeStateForLocalMove = ({
  presentationActive,
}: {
  hasPendingLocalMove: boolean;
  presentationActive: boolean;
}) => presentationActive;
