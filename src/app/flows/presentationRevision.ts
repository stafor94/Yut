export type PresentationRevisionGate = {
  issue: () => number;
  invalidate: () => number;
  isCurrent: (revision: number) => boolean;
  current: () => number;
};

/**
 * Queued presentation work must validate again when it executes. A queue key can
 * deduplicate identical work, but it cannot make an older captured snapshot safe
 * after a newer authoritative revision has arrived.
 */
export const createPresentationRevisionGate = (): PresentationRevisionGate => {
  let revision = 0;
  const advance = () => {
    revision += 1;
    return revision;
  };
  return {
    issue: advance,
    invalidate: advance,
    isCurrent: (candidate) => candidate === revision,
    current: () => revision,
  };
};
