export class PresentationAwarePendingActionSet extends Set<string> {
  constructor(private readonly isRollPresentationActive: () => boolean) {
    super();
  }

  override get size() {
    return super.size + (this.isRollPresentationActive() ? 1 : 0);
  }
}
