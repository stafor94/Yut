export const REMOTE_ROLL_PRESENTATION_MS = 2600;
export const MOVE_FRAME_PRESENTATION_MS = 240;

export type GameAnimationTask = () => void | Promise<void>;

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
  const pendingByKey = new Map<string, Promise<void>>();

  const reset = () => {
    generation += 1;
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
      let released = false;
      return () => {
        if (released) return;
        released = true;
        consumerCount = Math.max(0, consumerCount - 1);
        if (consumerCount === 0) reset();
      };
    },
    reset,
  };
}

export const gameAnimationQueue = createGameAnimationQueue();

export function waitForGameAnimation(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, durationMs));
  });
}
