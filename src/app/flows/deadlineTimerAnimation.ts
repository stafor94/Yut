import { getDeadlineTimerAnimationState } from '../../features/room/services/turnDeadlinePolicy';

export type DeadlineTimerAnimationSnapshot = ReturnType<typeof getDeadlineTimerAnimationState>;

export type DeadlineTimerAnimationCache = {
  get: (params: {
    key: string;
    deadlineAt: unknown;
    durationMs: unknown;
  }) => DeadlineTimerAnimationSnapshot;
  reset: () => void;
};

const normalizeDurationMs = (value: unknown) => {
  const durationMs = Number(value ?? 0);
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
};

export function createDeadlineTimerAnimationCache(now: () => number = Date.now): DeadlineTimerAnimationCache {
  let cachedKey = '';
  let cachedDurationMs = Number.NaN;
  let cachedSnapshot: DeadlineTimerAnimationSnapshot | null = null;

  return {
    get({ key, deadlineAt, durationMs }) {
      const normalizedDurationMs = normalizeDurationMs(durationMs);
      if (cachedSnapshot && cachedKey === key && cachedDurationMs === normalizedDurationMs) return cachedSnapshot;

      cachedKey = key;
      cachedDurationMs = normalizedDurationMs;
      cachedSnapshot = getDeadlineTimerAnimationState({
        deadlineAt,
        durationMs: normalizedDurationMs,
        now: now(),
      });
      return cachedSnapshot;
    },
    reset() {
      cachedKey = '';
      cachedDurationMs = Number.NaN;
      cachedSnapshot = null;
    },
  };
}
