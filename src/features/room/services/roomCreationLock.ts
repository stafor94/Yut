export const ROOM_CREATION_LOCK_WAIT_TIMEOUT_MS = 15_000;
export const ROOM_CREATION_LOCK_RETRY_INTERVAL_MS = 250;

type RoomCreationLockWaitOptions = {
  tryAcquire: () => Promise<boolean>;
  timeoutMs?: number;
  retryIntervalMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

const sleepFor = (delayMs: number) => new Promise<void>((resolve) => {
  globalThis.setTimeout(resolve, delayMs);
});

export async function waitForRoomCreationLock({
  tryAcquire,
  timeoutMs = ROOM_CREATION_LOCK_WAIT_TIMEOUT_MS,
  retryIntervalMs = ROOM_CREATION_LOCK_RETRY_INTERVAL_MS,
  now = Date.now,
  sleep = sleepFor,
}: RoomCreationLockWaitOptions) {
  const safeTimeoutMs = Math.max(0, timeoutMs);
  const safeRetryIntervalMs = Math.max(1, retryIntervalMs);
  const startedAt = now();

  while (true) {
    if (await tryAcquire()) return true;

    const remainingMs = safeTimeoutMs - Math.max(0, now() - startedAt);
    if (remainingMs <= 0) return false;
    await sleep(Math.min(safeRetryIntervalMs, remainingMs));
  }
}
