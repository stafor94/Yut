import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSequenceRecoveryWatchdog,
  setSequenceRecoveryRoomContext,
  type SequenceRecoveryScheduler,
} from '../../src/app/hooks/sequenceRecoveryWatchdog.js';

class FakeScheduler implements SequenceRecoveryScheduler {
  private currentTime = 0;
  private nextTimerId = 1;
  private tasks = new Map<number, { dueAt: number; callback: () => void }>();

  now = () => this.currentTime;

  setTimeout = (callback: () => void, delayMs: number) => {
    const timerId = this.nextTimerId;
    this.nextTimerId += 1;
    this.tasks.set(timerId, { dueAt: this.currentTime + Math.max(0, delayMs), callback });
    return timerId;
  };

  clearTimeout = (timerId: number) => {
    this.tasks.delete(timerId);
  };

  async advanceBy(delayMs: number) {
    const targetTime = this.currentTime + delayMs;
    while (true) {
      const nextTask = [...this.tasks.entries()]
        .filter(([, task]) => task.dueAt <= targetTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!nextTask) break;
      const [timerId, task] = nextTask;
      this.tasks.delete(timerId);
      this.currentTime = task.dueAt;
      task.callback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.currentTime = targetTime;
  }
}

const createContextWatchdog = (
  scheduler: FakeScheduler,
  callbacks: { soft?: () => void; hard?: () => void; fatal?: () => void } = {},
) => createSequenceRecoveryWatchdog({
  runCheck: async () => 'deferred',
  scheduler,
  initialDelayMs: 5000,
  retryDelaysMs: [5000, 10000, 20000],
  maxAttempts: 4,
  maxTotalMs: 40000,
  softRecoveryAfterMs: 30000,
  hardRecoveryAfterMs: 60000,
  fatalRecoveryAfterMs: 120000,
  fatalDeferredRetryMs: 5000,
  maxFatalDeferrals: 1,
  onSoftRecovery: callbacks.soft,
  onHardRecovery: callbacks.hard,
  onFatalRecovery: callbacks.fatal,
});

test('게임 room context가 활성화되면 내 턴처럼 기존 watch key가 없어도 단계 복구를 수행한다', async () => {
  setSequenceRecoveryRoomContext('', false);
  const scheduler = new FakeScheduler();
  let softRecoveries = 0;
  let hardRecoveries = 0;
  let fatalRecoveries = 0;
  const watchdog = createContextWatchdog(scheduler, {
    soft: () => { softRecoveries += 1; },
    hard: () => { hardRecoveries += 1; },
    fatal: () => { fatalRecoveries += 1; },
  });

  setSequenceRecoveryRoomContext('room-a', true);
  watchdog.notifySequence(10);
  await scheduler.advanceBy(30000);
  assert.equal(softRecoveries, 1);
  assert.equal(hardRecoveries, 0);

  await scheduler.advanceBy(30000);
  assert.equal(hardRecoveries, 1);

  await scheduler.advanceBy(65000);
  assert.equal(fatalRecoveries, 1);

  setSequenceRecoveryRoomContext('room-a', false);
  watchdog.dispose();
});

test('게임 화면 context가 비활성화되면 예약된 복구를 모두 취소한다', async () => {
  setSequenceRecoveryRoomContext('', false);
  const scheduler = new FakeScheduler();
  let softRecoveries = 0;
  const watchdog = createContextWatchdog(scheduler, {
    soft: () => { softRecoveries += 1; },
  });

  setSequenceRecoveryRoomContext('room-a', true);
  watchdog.notifySequence(1);
  await scheduler.advanceBy(15000);
  setSequenceRecoveryRoomContext('room-a', false);
  await scheduler.advanceBy(120000);

  assert.equal(softRecoveries, 0);
  watchdog.dispose();
});
