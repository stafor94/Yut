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
};

export function enqueueCapturePresentation({
  key,
  durationMs,
  start,
  queue = gameAnimationQueue,
  lock = gamePresentationLock,
  wait = waitForGameAnimation,
}: CapturePresentationQueueOptions) {
  const releasePresentation = lock.acquire();
  const execution = queue.enqueue(key, async () => {
    if (start() === false) return;
    await wait(Math.max(0, durationMs));
  });
  return execution.finally(releasePresentation);
}
