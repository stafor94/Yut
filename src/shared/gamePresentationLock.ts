export const GAME_PRESENTATION_BLOCKED_ACTION_TYPES = [
  'roll_yut',
  'move_piece',
  'use_item',
  'place_trap',
  'item_pickup_decision',
] as const;

const blockedActionTypes = new Set<string>(GAME_PRESENTATION_BLOCKED_ACTION_TYPES);

export type GamePresentationLock = {
  acquire: () => () => void;
  isLocked: () => boolean;
  waitUntilIdle: () => Promise<void>;
  reset: () => void;
};

export function createGamePresentationLock(): GamePresentationLock {
  let activeCount = 0;
  let idleCheckVersion = 0;
  let idleCheckPending = false;
  const idleWaiters = new Set<() => void>();

  const releaseIdleWaiters = () => {
    const waiters = Array.from(idleWaiters);
    idleWaiters.clear();
    waiters.forEach((resolve) => resolve());
  };

  const isLocked = () => activeCount > 0 || idleCheckPending;

  return {
    acquire() {
      activeCount += 1;
      idleCheckPending = false;
      idleCheckVersion += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeCount = Math.max(0, activeCount - 1);
        if (activeCount !== 0) return;
        idleCheckPending = true;
        const scheduledVersion = ++idleCheckVersion;
        void Promise.resolve().then(() => {
          if (activeCount !== 0 || !idleCheckPending || idleCheckVersion !== scheduledVersion) return;
          idleCheckPending = false;
          releaseIdleWaiters();
        });
      };
    },
    isLocked,
    waitUntilIdle() {
      if (!isLocked()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.add(resolve));
    },
    reset() {
      activeCount = 0;
      idleCheckPending = false;
      idleCheckVersion += 1;
      releaseIdleWaiters();
    },
  };
}

export const gamePresentationLock = createGamePresentationLock();

export function shouldWaitForGamePresentation(actionType: string) {
  return blockedActionTypes.has(actionType);
}

export function waitForGamePresentationBeforeAction(
  actionType: string,
  lock: GamePresentationLock = gamePresentationLock,
) {
  if (!shouldWaitForGamePresentation(actionType) || !lock.isLocked()) return Promise.resolve();
  return lock.waitUntilIdle();
}
