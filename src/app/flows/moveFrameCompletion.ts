export type MoveFrameCompletionSource = 'transition' | 'fallback' | 'cancelled';

export type MoveFrameCompletionIdentity = {
  pieceId: string;
  frameKey: string;
};

export type MoveFrameTransitionEventIdentity = MoveFrameCompletionIdentity & {
  propertyName: string;
};

type ScheduleFallback = (callback: () => void, delayMs: number) => () => void;

type TransitionStyleSnapshot = {
  transitionProperty: string | null | undefined;
  transitionDuration: string | null | undefined;
  transitionDelay: string | null | undefined;
};

type AnimationFrameRuntime = typeof globalThis & {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (animationFrameId: number) => void;
};

const POSITION_TRANSITION_PROPERTIES = new Set(['left', 'top', 'translate']);

const scheduleFallbackWithTimer: ScheduleFallback = (callback, delayMs) => {
  let animationFrameId: number | null = null;
  const runtime = globalThis as AnimationFrameRuntime;
  const timer = setTimeout(() => {
    if (typeof runtime.requestAnimationFrame === 'function') {
      animationFrameId = runtime.requestAnimationFrame(() => {
        animationFrameId = null;
        callback();
      });
      return;
    }
    callback();
  }, Math.max(0, delayMs));
  return () => {
    clearTimeout(timer);
    if (animationFrameId !== null && typeof runtime.cancelAnimationFrame === 'function') {
      runtime.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };
};

const normalizeCssText = (value: string | null | undefined) => typeof value === 'string' ? value : '';
const splitCssList = (value: string | null | undefined) => normalizeCssText(value).split(',').map((entry) => entry.trim()).filter(Boolean);

const parseCssTimeMs = (value: string | null | undefined) => {
  const normalized = normalizeCssText(value).trim().toLowerCase();
  if (normalized.endsWith('ms')) return Number.parseFloat(normalized) || 0;
  if (normalized.endsWith('s')) return (Number.parseFloat(normalized) || 0) * 1000;
  return 0;
};

export function isMovePositionTransitionProperty(propertyName: string | null | undefined) {
  return POSITION_TRANSITION_PROPERTIES.has(normalizeCssText(propertyName).trim().toLowerCase());
}

export function getMoveFrameTransitionMs(style: TransitionStyleSnapshot) {
  const properties = splitCssList(style.transitionProperty);
  const durations = splitCssList(style.transitionDuration).map(parseCssTimeMs);
  const delays = splitCssList(style.transitionDelay).map(parseCssTimeMs);
  if (!properties.length || !durations.length) return 0;

  let completionMs = 0;
  const count = Math.max(properties.length, durations.length, delays.length || 1);
  for (let index = 0; index < count; index += 1) {
    const property = properties[index % properties.length].toLowerCase();
    if (property !== 'all' && !isMovePositionTransitionProperty(property)) continue;
    const durationMs = durations[index % durations.length] ?? 0;
    const delayMs = delays.length ? (delays[index % delays.length] ?? 0) : 0;
    completionMs = Math.max(completionMs, Math.max(0, durationMs + delayMs));
  }
  return completionMs;
}

export function createMoveFrameTransitionTracker() {
  const pendingByProperty = new Map<string, number>();
  let pendingCount = 0;

  const normalizeProperty = (propertyName: string | null | undefined) => normalizeCssText(propertyName).trim().toLowerCase();

  return {
    start(propertyName: string | null | undefined) {
      const property = normalizeProperty(propertyName);
      if (!isMovePositionTransitionProperty(property)) return false;
      pendingByProperty.set(property, (pendingByProperty.get(property) ?? 0) + 1);
      pendingCount += 1;
      return true;
    },
    settle(propertyName: string | null | undefined) {
      const property = normalizeProperty(propertyName);
      const count = pendingByProperty.get(property) ?? 0;
      if (count <= 0) return false;
      if (count === 1) pendingByProperty.delete(property);
      else pendingByProperty.set(property, count - 1);
      pendingCount = Math.max(0, pendingCount - 1);
      return true;
    },
    hasPending() {
      return pendingCount > 0;
    },
    getPendingCount() {
      return pendingCount;
    },
    clear() {
      pendingByProperty.clear();
      pendingCount = 0;
    },
  };
}

export function createMoveFrameTransitionIdentityQueue() {
  const queues = new Map<string, MoveFrameTransitionEventIdentity[]>();
  const getKey = (pieceId: string, propertyName: string | null | undefined) => `${pieceId}:${normalizeCssText(propertyName).trim().toLowerCase()}`;
  return {
    remember(identity: MoveFrameTransitionEventIdentity) {
      const normalizedPropertyName = normalizeCssText(identity.propertyName).trim().toLowerCase();
      if (!normalizedPropertyName) return false;
      const key = getKey(identity.pieceId, normalizedPropertyName);
      const queue = queues.get(key) ?? [];
      queue.push({ ...identity, propertyName: normalizedPropertyName });
      queues.set(key, queue);
      return true;
    },
    consume(pieceId: string, propertyName: string | null | undefined) {
      const normalizedPropertyName = normalizeCssText(propertyName).trim().toLowerCase();
      if (!normalizedPropertyName) return null;
      const key = getKey(pieceId, normalizedPropertyName);
      const queue = queues.get(key);
      const identity = queue?.shift() ?? null;
      if (!queue?.length) queues.delete(key);
      return identity;
    },
    clear() {
      queues.clear();
    },
  };
}

export function createMoveFrameCompletionGate(identity: MoveFrameCompletionIdentity) {
  let settled = false;
  let transitionStarted = false;
  let cancelFallback: (() => void) | null = null;
  let resolvePromise!: (source: MoveFrameCompletionSource) => void;
  const promise = new Promise<MoveFrameCompletionSource>((resolve) => {
    resolvePromise = resolve;
  });

  const matches = (candidate: MoveFrameCompletionIdentity) => candidate.pieceId === identity.pieceId
    && candidate.frameKey === identity.frameKey;

  const clearFallback = () => {
    cancelFallback?.();
    cancelFallback = null;
  };

  const settle = (source: MoveFrameCompletionSource) => {
    if (settled) return false;
    settled = true;
    clearFallback();
    resolvePromise(source);
    return true;
  };

  return {
    ...identity,
    promise,
    complete(candidate: MoveFrameCompletionIdentity) {
      if (!matches(candidate)) return false;
      return settle('transition');
    },
    armFallback(candidate: MoveFrameCompletionIdentity, delayMs: number, schedule: ScheduleFallback = scheduleFallbackWithTimer) {
      if (settled || transitionStarted || !matches(candidate)) return false;
      if (cancelFallback) {
        transitionStarted = true;
        clearFallback();
        return false;
      }
      cancelFallback = schedule(() => {
        if (transitionStarted) return;
        settle('fallback');
      }, Math.max(0, delayMs));
      return true;
    },
    cancel() {
      return settle('cancelled');
    },
    isSettled() {
      return settled;
    },
  };
}

export type MoveFrameCompletionGate = ReturnType<typeof createMoveFrameCompletionGate>;
