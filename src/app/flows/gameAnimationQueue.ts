import { gamePresentationLock, type GamePresentationLock } from '../../shared/gamePresentationLock';
import { REMOTE_ROLL_PRE_RESULT_MS } from './yutRollAnimation';

export const REMOTE_ROLL_RESULT_HOLD_MS = 1400;
export const REMOTE_ROLL_PRESENTATION_MS = REMOTE_ROLL_PRE_RESULT_MS + REMOTE_ROLL_RESULT_HOLD_MS;
export const MOVE_FRAME_PRESENTATION_MS = 240;

export function getRollPresentationAnimationId(sourceAnimationId: number, now = Date.now()) {
  return Math.max(sourceAnimationId, now);
}

export type GameAnimationTask = () => void | Promise<void>;

export type GameAnimationSequence<T> = {
  wait: () => Promise<T | null>;
  resolve: (value: T) => void;
  cancel: () => void;
  isSettled: () => boolean;
};

export function createGameAnimationSequence<T>(): GameAnimationSequence<T> {
  let settled = false;
  let settlePromise!: (value: T | null) => void;
  const promise = new Promise<T | null>((resolve) => {
    settlePromise = resolve;
  });
  const settle = (value: T | null) => {
    if (settled) return;
    settled = true;
    settlePromise(value);
  };

  return {
    wait: () => promise,
    resolve: (value) => settle(value),
    cancel: () => settle(null),
    isSettled: () => settled,
  };
}

export type GameAnimationQueue = {
  enqueue: (key: string, task: GameAnimationTask) => Promise<void>;
  has: (key: string) => boolean;
  isBusy: () => boolean;
  acquire: () => () => void;
  reset: () => void;
};

export function createGameAnimationQueue(): GameAnimationQueue {
  let tail = Promise.resolve();
  let generation = 0;
  let pendingCount = 0;
  let consumerCount = 0;
  let releaseCheckVersion = 0;
  const pendingByKey = new Map<string, Promise<void>>();

  const reset = () => {
    generation += 1;
    releaseCheckVersion += 1;
    tail = Promise.resolve();
    pendingCount = 0;
    pendingByKey.clear();
  };

  return {
    enqueue(key, task) {
      const existing = pendingByKey.get(key);
      if (existing) return existing;

      const taskGeneration = generation;
      pendingCount += 1;
      const execution = tail
        .catch(() => undefined)
        .then(async () => {
          if (taskGeneration !== generation) return;
          await task();
        });
      const tracked = execution.finally(() => {
        if (pendingByKey.get(key) === tracked) pendingByKey.delete(key);
        pendingCount = Math.max(0, pendingCount - 1);
      });

      pendingByKey.set(key, tracked);
      tail = tracked.catch(() => undefined);
      return tracked;
    },
    has(key) {
      return pendingByKey.has(key);
    },
    isBusy() {
      return pendingCount > 0;
    },
    acquire() {
      consumerCount += 1;
      releaseCheckVersion += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        consumerCount = Math.max(0, consumerCount - 1);
        if (consumerCount !== 0) return;
        const scheduledVersion = ++releaseCheckVersion;
        void Promise.resolve().then(() => {
          if (consumerCount === 0 && releaseCheckVersion === scheduledVersion) reset();
        });
      };
    },
    reset,
  };
}

export const gameAnimationQueue = createGameAnimationQueue();

type QueuedRollPresentationOptions<TAnimation extends { id: number }> = {
  key: string;
  animation: TAnimation;
  task: (animation: TAnimation) => void | Promise<void>;
  queue?: GameAnimationQueue;
  lock?: GamePresentationLock;
  now?: () => number;
};

export function enqueueRollPresentation<TAnimation extends { id: number }>({
  key,
  animation,
  task,
  queue = gameAnimationQueue,
  lock = gamePresentationLock,
  now = Date.now,
}: QueuedRollPresentationOptions<TAnimation>) {
  const releasePresentation = lock.acquire();
  const execution = queue.enqueue(key, async () => {
    const presentedAnimation = {
      ...animation,
      id: getRollPresentationAnimationId(animation.id, now()),
    };
    await task(presentedAnimation);
  });
  return execution.finally(releasePresentation);
}

export function waitForGameAnimation(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, durationMs));
  });
}
