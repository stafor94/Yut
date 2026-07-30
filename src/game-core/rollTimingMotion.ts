import { getRollTimingPositionPercent } from './roll';

export const ROLL_TIMING_CYCLE_MS = 2000;
export const ROLL_TIMING_INITIAL_MAX_PERCENT = 30;

export type RollTimingOpportunitySnapshot = Readonly<{
  key: string;
  startedAt: number;
  deadlineAt: number;
  initialPositionPercent: number;
  initialPhaseMs: number;
}>;

export type RollTimingMotionState = Readonly<{
  phaseMs: number;
  positionPercent: number;
}>;

type RollTimingOpportunitySnapshotCache = {
  get: (params: {
    key: string;
    startedAt: unknown;
    deadlineAt: unknown;
    initialPositionPercent?: unknown;
  }) => RollTimingOpportunitySnapshot;
  reset: () => void;
};

const normalizeEpochMs = (value: unknown) => {
  const epochMs = Number(value ?? 0);
  return Number.isFinite(epochMs) && epochMs > 0 ? epochMs : 0;
};

const normalizeInitialPositionPercent = (value: unknown) => {
  const positionPercent = Number(value ?? 0);
  return Number.isFinite(positionPercent)
    ? Math.max(0, Math.min(ROLL_TIMING_INITIAL_MAX_PERCENT, positionPercent))
    : 0;
};

const normalizePhaseMs = (phaseMs: number) => (
  ((phaseMs % ROLL_TIMING_CYCLE_MS) + ROLL_TIMING_CYCLE_MS) % ROLL_TIMING_CYCLE_MS
);

const clampRandomUnit = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export function sampleRollTimingInitialPositionPercent(sample: () => number = Math.random) {
  return clampRandomUnit(sample()) * ROLL_TIMING_INITIAL_MAX_PERCENT;
}

/**
 * Produces a stable pseudo-random unit value from an authoritative deadline.
 * Every client and timeout recovery path can reconstruct the same opportunity
 * without persisting another mutable field in the room snapshot.
 */
export function getRollTimingInitialPositionPercentForDeadline(deadlineAt: unknown) {
  const normalizedDeadlineAt = normalizeEpochMs(deadlineAt);
  let seed = (Math.trunc(normalizedDeadlineAt) ^ Math.trunc(normalizedDeadlineAt / 0x100000000)) >>> 0;
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  seed = (seed ^ (seed >>> 16)) >>> 0;
  return sampleRollTimingInitialPositionPercent(() => seed / 0xffffffff);
}

export function getRollTimingInitialPhaseMs(initialPositionPercent: unknown) {
  return (normalizeInitialPositionPercent(initialPositionPercent) / 100) * (ROLL_TIMING_CYCLE_MS / 2);
}

export function getRollTimingMotionState({
  initialPositionPercent,
  elapsedMs,
}: {
  initialPositionPercent: unknown;
  elapsedMs: unknown;
}): RollTimingMotionState {
  const normalizedElapsedMs = Number(elapsedMs ?? 0);
  const phaseMs = normalizePhaseMs(
    getRollTimingInitialPhaseMs(initialPositionPercent)
      + (Number.isFinite(normalizedElapsedMs) ? Math.max(0, normalizedElapsedMs) : 0),
  );
  return Object.freeze({
    phaseMs,
    positionPercent: getRollTimingPositionPercent(phaseMs),
  });
}

export function getRollTimingOpportunityStateAt(
  snapshot: RollTimingOpportunitySnapshot,
  at: unknown,
): RollTimingMotionState {
  const normalizedAt = normalizeEpochMs(at);
  return getRollTimingMotionState({
    initialPositionPercent: snapshot.initialPositionPercent,
    elapsedMs: Math.max(0, normalizedAt - snapshot.startedAt),
  });
}

export function createRollTimingOpportunitySnapshotCache(
  sampleInitialPosition?: () => number,
  maxEntries = 128,
): RollTimingOpportunitySnapshotCache {
  const snapshots = new Map<string, RollTimingOpportunitySnapshot>();
  const normalizedMaxEntries = Math.max(1, Math.trunc(maxEntries));

  return {
    get({ key, startedAt, deadlineAt, initialPositionPercent: providedInitialPositionPercent }) {
      const normalizedStartedAt = normalizeEpochMs(startedAt);
      const normalizedDeadlineAt = normalizeEpochMs(deadlineAt);
      const cacheKey = `${key}:${normalizedStartedAt}:${normalizedDeadlineAt}`;
      const cached = snapshots.get(cacheKey);
      if (cached) return cached;

      const hasProvidedInitialPosition = Number.isFinite(Number(providedInitialPositionPercent));
      const initialPositionPercent = hasProvidedInitialPosition
        ? normalizeInitialPositionPercent(providedInitialPositionPercent)
        : sampleInitialPosition
          ? sampleRollTimingInitialPositionPercent(sampleInitialPosition)
          : getRollTimingInitialPositionPercentForDeadline(normalizedDeadlineAt);
      const snapshot = Object.freeze({
        key,
        startedAt: normalizedStartedAt,
        deadlineAt: normalizedDeadlineAt,
        initialPositionPercent,
        initialPhaseMs: getRollTimingInitialPhaseMs(initialPositionPercent),
      });
      snapshots.set(cacheKey, snapshot);
      while (snapshots.size > normalizedMaxEntries) {
        const oldestKey = snapshots.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        snapshots.delete(oldestKey);
      }
      return snapshot;
    },
    reset() {
      snapshots.clear();
    },
  };
}

export const rollTimingOpportunitySnapshotCache = createRollTimingOpportunitySnapshotCache();
