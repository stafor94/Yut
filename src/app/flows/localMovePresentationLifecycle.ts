export type LocalMovePresentationPhase = 'idle' | 'pending' | 'presenting';

export type LocalMovePresentationSnapshot = {
  generation: number;
  actionKey: string;
  pieceId: string;
  phase: LocalMovePresentationPhase;
};

type ExpectedLocalMoveSettlement = {
  actionKey: string;
  pieceId: string;
  pathNodeIds: string[];
  promise: Promise<void>;
  resolve: () => void;
};

const normalizePathNodeIds = (pathNodeIds: string[]) => pathNodeIds.filter((nodeId) => Boolean(nodeId));

const pathsMatch = (left: string[], right: string[]) => (
  left.length === right.length && left.every((nodeId, index) => nodeId === right[index])
);

export class LocalMovePresentationLifecycle {
  private snapshotValue: LocalMovePresentationSnapshot = {
    generation: 0,
    actionKey: '',
    pieceId: '',
    phase: 'idle',
  };

  private settlementPromise: Promise<void> = Promise.resolve();
  private resolveSettlement: (() => void) | null = null;
  private expectedSettlement: ExpectedLocalMoveSettlement | null = null;
  private expectedPathNodeIds: string[] = [];
  private observedPathNodeIndex = 0;

  begin(actionKey: string) {
    if (!actionKey) return this.snapshotValue.generation;
    if (this.snapshotValue.phase !== 'idle' && this.snapshotValue.actionKey === actionKey) {
      return this.snapshotValue.generation;
    }
    if (this.snapshotValue.phase !== 'idle') this.finishCurrent();
    if (this.expectedSettlement && this.expectedSettlement.actionKey !== actionKey) {
      this.resolveExpectedSettlement();
    }
    const generation = this.snapshotValue.generation + 1;
    this.snapshotValue = {
      generation,
      actionKey,
      pieceId: '',
      phase: 'pending',
    };
    if (this.expectedSettlement?.actionKey === actionKey) {
      this.adoptExpectedSettlement();
    } else {
      this.setExpectedPath([]);
      this.createSettlementPromise();
    }
    return generation;
  }

  expectNextSettlement(actionKey: string, pieceId: string, pathNodeIds: string[] = []) {
    if (!actionKey || !pieceId) return false;
    const normalizedPathNodeIds = normalizePathNodeIds(pathNodeIds);
    if (this.snapshotValue.phase !== 'idle' && this.snapshotValue.actionKey === actionKey) {
      this.setExpectedPath(normalizedPathNodeIds);
      return true;
    }
    if (this.snapshotValue.phase !== 'idle') this.finishCurrent();
    if (this.expectedSettlement?.actionKey === actionKey && this.expectedSettlement.pieceId === pieceId) {
      if (normalizedPathNodeIds.length) this.expectedSettlement.pathNodeIds = normalizedPathNodeIds;
      return true;
    }
    this.resolveExpectedSettlement();
    let resolve: () => void = () => {};
    const promise = new Promise<void>((nextResolve) => {
      resolve = nextResolve;
    });
    this.expectedSettlement = {
      actionKey,
      pieceId,
      pathNodeIds: normalizedPathNodeIds,
      promise,
      resolve,
    };
    return true;
  }

  observe(pieceId: string, nodeId = '') {
    if (!pieceId) return false;
    if (this.snapshotValue.phase === 'idle') {
      if (!this.expectedSettlement || this.expectedSettlement.pieceId !== pieceId) return false;
      this.snapshotValue = {
        generation: this.snapshotValue.generation + 1,
        actionKey: this.expectedSettlement.actionKey,
        pieceId,
        phase: 'presenting',
      };
      this.adoptExpectedSettlement();
      this.observePathNode(nodeId);
      return true;
    }
    this.snapshotValue = {
      ...this.snapshotValue,
      pieceId,
      phase: 'presenting',
    };
    this.observePathNode(nodeId);
    return true;
  }

  settle(pieceId = '') {
    if (this.snapshotValue.phase !== 'presenting') return false;
    if (!pieceId || pieceId !== this.snapshotValue.pieceId) return false;
    if (this.expectedPathNodeIds.length && this.observedPathNodeIndex < this.expectedPathNodeIds.length) return false;
    this.finishCurrent();
    return true;
  }

  cancel() {
    const hadPendingSettlement = this.snapshotValue.phase !== 'idle' || Boolean(this.expectedSettlement);
    if (!hadPendingSettlement) return false;
    if (this.snapshotValue.phase !== 'idle') this.finishCurrent();
    this.resolveExpectedSettlement();
    return true;
  }

  isActive() {
    return this.snapshotValue.phase !== 'idle';
  }

  snapshot() {
    return { ...this.snapshotValue };
  }

  waitForSettlement() {
    if (this.snapshotValue.phase !== 'idle') return this.settlementPromise;
    return this.expectedSettlement?.promise ?? Promise.resolve();
  }

  private createSettlementPromise() {
    this.settlementPromise = new Promise<void>((resolve) => {
      this.resolveSettlement = resolve;
    });
  }

  private adoptExpectedSettlement() {
    if (!this.expectedSettlement) return;
    this.settlementPromise = this.expectedSettlement.promise;
    this.resolveSettlement = this.expectedSettlement.resolve;
    this.setExpectedPath(this.expectedSettlement.pathNodeIds);
    this.expectedSettlement = null;
  }

  private resolveExpectedSettlement() {
    const expectedSettlement = this.expectedSettlement;
    this.expectedSettlement = null;
    expectedSettlement?.resolve();
  }

  private setExpectedPath(pathNodeIds: string[]) {
    if (pathsMatch(this.expectedPathNodeIds, pathNodeIds)) return;
    this.expectedPathNodeIds = [...pathNodeIds];
    this.observedPathNodeIndex = 0;
  }

  private observePathNode(nodeId: string) {
    if (!nodeId || this.observedPathNodeIndex >= this.expectedPathNodeIds.length) return;
    if (nodeId === this.expectedPathNodeIds[this.observedPathNodeIndex]) {
      this.observedPathNodeIndex += 1;
    }
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
    this.setExpectedPath([]);
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
