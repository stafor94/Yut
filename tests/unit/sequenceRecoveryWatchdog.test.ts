import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSequenceRecoveryWatchdog,
  notifySequenceRecoveryProgress,
  shouldDeferSequenceRecovery,
  type SequenceRecoveryCheckResult,
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

const createWatchdog = (
  scheduler: FakeScheduler,
  runCheck: () => Promise<SequenceRecoveryCheckResult>,
  callbacks: { hard?: () => void; fatal?: () => void } = {},
) => createSequenceRecoveryWatchdog({
  runCheck,
  scheduler,
  initialDelayMs: 5000,
  retryDelaysMs: [5000, 10000, 20000],
  maxAttempts: 4,
  maxTotalMs: 40000,
  softRecoveryAfterMs: 30000,
  hardRecoveryAfterMs: 60000,
  fatalRecoveryAfterMs: 120000,
  onHardRecovery: callbacks.hard,
  onFatalRecovery: callbacks.fatal,
});

test('동일 sequence snapshot은 30초 감시 시간을 초기화하지 않는다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(7);
  await scheduler.advanceBy(20000);
  watchdog.notifySnapshot();
  watchdog.notifySequence(7);
  await scheduler.advanceBy(9999);
  assert.equal(checks, 0);
  await scheduler.advanceBy(1);
  assert.equal(checks, 1);
});

test('더 높은 sequence가 도착하면 단계별 복구 시간을 처음부터 다시 센다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(2);
  await scheduler.advanceBy(25000);
  watchdog.notifySequence(3);
  await scheduler.advanceBy(29999);
  assert.equal(checks, 0);
  await scheduler.advanceBy(1);
  assert.equal(checks, 1);
});

test('30초에는 1차 조회, 60초에는 listener 강제 복구와 재조회가 수행된다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  let hardRecoveries = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  }, { hard: () => { hardRecoveries += 1; } });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(1);
  await scheduler.advanceBy(30000);
  assert.equal(checks, 1);
  assert.equal(hardRecoveries, 0);
  await scheduler.advanceBy(30000);
  assert.equal(checks, 2);
  assert.equal(hardRecoveries, 1);
});

test('120초 최종 조회에도 변화가 없으면 치명 복구를 한 번만 요청한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  let fatalRecoveries = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  }, { fatal: () => { fatalRecoveries += 1; } });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(1);
  await scheduler.advanceBy(120000);

  assert.equal(checks, 3);
  assert.equal(fatalRecoveries, 1);
  await scheduler.advanceBy(60000);
  assert.equal(fatalRecoveries, 1);
});

test('120초 최종 조회에서 새 sequence를 적용하면 종료하지 않고 감시를 초기화한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  let fatalRecoveries = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return checks === 3 ? 'changed' : 'unchanged';
  }, { fatal: () => { fatalRecoveries += 1; } });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(1);
  await scheduler.advanceBy(120000);
  assert.equal(fatalRecoveries, 0);

  await scheduler.advanceBy(29999);
  assert.equal(checks, 3);
  await scheduler.advanceBy(1);
  assert.equal(checks, 4);
});

test('최종 조회가 다른 복구 흐름 때문에 deferred되면 5초 뒤 다시 확인한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  let fatalRecoveries = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return checks === 3 ? 'deferred' : 'unchanged';
  }, { fatal: () => { fatalRecoveries += 1; } });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(1);
  await scheduler.advanceBy(120000);
  assert.equal(fatalRecoveries, 0);
  await scheduler.advanceBy(4999);
  assert.equal(checks, 3);
  await scheduler.advanceBy(1);
  assert.equal(checks, 4);
  assert.equal(fatalRecoveries, 1);
});

test('전역 sequence 진행 알림은 같은 방 watchdog만 초기화한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  notifySequenceRecoveryProgress('room-a', 10);
  await scheduler.advanceBy(25000);
  notifySequenceRecoveryProgress('room-b', 99);
  await scheduler.advanceBy(5000);
  assert.equal(checks, 1);
  watchdog.dispose();
});

test('페이지 복귀 즉시 확인은 30초 예약을 기다리지 않고 실행한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  watchdog.notifySequence(1);
  await scheduler.advanceBy(1200);
  const triggered = await watchdog.triggerNow();

  assert.equal(triggered, true);
  assert.equal(checks, 1);
  await scheduler.advanceBy(28799);
  assert.equal(checks, 1);
  await scheduler.advanceBy(1);
  assert.equal(checks, 2);
});

test('기존 replay, 이동, snapshot 적용, 수동 동기화, pending action, deadline 복구와 충돌하면 deferred한다', () => {
  const idleState = {
    sequenceReplayInProgress: false,
    moveInProgress: false,
    applyingSyncedState: false,
    manualSequenceSyncing: false,
    hasPendingRemoteActions: false,
    turnRecoveryInFlight: false,
  };

  assert.equal(shouldDeferSequenceRecovery(idleState), false);
  for (const key of Object.keys(idleState) as Array<keyof typeof idleState>) {
    assert.equal(shouldDeferSequenceRecovery({ ...idleState, [key]: true }), true, `${key} conflict was not deferred`);
  }
});
