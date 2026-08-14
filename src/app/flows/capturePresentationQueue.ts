import { gamePresentationLock, type GamePresentationLock } from '../../shared/gamePresentationLock';
import {
  gameAnimationQueue,
  waitForGameAnimation,
  type GameAnimationQueue,
} from './gameAnimationQueue';

type CapturePresentationQueueOptions = {
  key: string;
  durationMs: number;
  start: () => boolean | void;
  queue?: GameAnimationQueue;
  lock?: GamePresentationLock;
  wait?: (durationMs: number) => Promise<void>;
  waitForVisualSettle?: () => Promise<void>;
};

type AnimationFrameRuntime = typeof globalThis & {
  requestAnimationFrame?: (callback: () => void) => number;
};

const waitForNextAnimationFrame = () => new Promise<void>((resolve) => {
  const runtime = globalThis as AnimationFrameRuntime;
  if (typeof runtime.requestAnimationFrame === 'function') {
    runtime.requestAnimationFrame(() => resolve());
    return;
  }
  void Promise.resolve().then(resolve);
});

export function enqueueCapturePresentation({
  key,
  durationMs,
  start,
  queue = gameAnimationQueue,
  lock = gamePresentationLock,
  wait = waitForGameAnimation,
  waitForVisualSettle = waitForNextAnimationFrame,
}: CapturePresentationQueueOptions) {
  const releasePresentation = lock.acquire();
  const execution = queue.enqueue(key, async () => {
    await waitForVisualSettle();
    if (start() === false) return;
    await wait(Math.max(0, durationMs));
  });
  return execution.finally(releasePresentation);
}
