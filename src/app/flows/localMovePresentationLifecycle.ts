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

export const shouldDeferAuthoritativeStateForLocalMove = ({
  presentationActive,
}: {
  hasPendingLocalMove: boolean;
  presentationActive: boolean;
}) => presentationActive;
