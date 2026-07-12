import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSequenceRecoveryWatchdog,
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
    }
    this.currentTime = targetTime;
    await Promise.resolve();
    await Promise.resolve();
  }
}

const createWatchdog = (
  scheduler: FakeScheduler,
  runCheck: () => Promise<SequenceRecoveryCheckResult>,
) => createSequenceRecoveryWatchdog({
  runCheck,
  scheduler,
  initialDelayMs: 5000,
  retryDelaysMs: [5000, 10000, 20000],
  maxAttempts: 4,
  maxTotalMs: 40000,
});

test('정상 snapshot이 계속 도착하면 sequence query를 실행하지 않는다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(4000);
  watchdog.notifySnapshot();
  await scheduler.advanceBy(4000);
  watchdog.notifySnapshot();
  await scheduler.advanceBy(4000);
  watchdog.notifySnapshot();

  assert.equal(checks, 0);
});

test('listener가 멈추면 5초 후 단발 복구 확인을 실행한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(4999);
  assert.equal(checks, 0);
  await scheduler.advanceBy(1);
  assert.equal(checks, 1);
});

test('예약 중 snapshot이 도착하면 기존 watchdog을 취소하고 5초를 다시 센다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(4000);
  watchdog.notifySnapshot();
  await scheduler.advanceBy(1000);
  assert.equal(checks, 0);
  await scheduler.advanceBy(3999);
  assert.equal(checks, 0);
  await scheduler.advanceBy(1);
  assert.equal(checks, 1);
});

test('변화가 없거나 조회가 실패하면 5초, 10초, 20초 백오프 후 최대 4회에서 멈춘다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return checks === 2 ? 'failed' : 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(5000);
  assert.equal(checks, 1);
  await scheduler.advanceBy(5000);
  assert.equal(checks, 2);
  await scheduler.advanceBy(10000);
  assert.equal(checks, 3);
  await scheduler.advanceBy(20000);
  assert.equal(checks, 4);
  await scheduler.advanceBy(60000);
  assert.equal(checks, 4);
});

test('최대 총 복구시간을 넘기는 다음 확인은 예약하지 않는다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createSequenceRecoveryWatchdog({
    runCheck: async () => {
      checks += 1;
      return 'unchanged';
    },
    scheduler,
    initialDelayMs: 5000,
    retryDelaysMs: [5000, 10000, 20000],
    maxAttempts: 99,
    maxTotalMs: 15000,
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(5000);
  await scheduler.advanceBy(5000);
  await scheduler.advanceBy(60000);

  assert.equal(checks, 2);
});

test('페이지 복귀 즉시 확인은 예약 시간을 기다리지 않고 실행한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(1200);
  const triggered = await watchdog.triggerNow();

  assert.equal(triggered, true);
  assert.equal(checks, 1);
});

test('조회 중 snapshot이 도착하면 완료 후 즉시 재조회하지 않고 새 5초 기준으로 재예약한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  let resolveCheck: (result: SequenceRecoveryCheckResult) => void = () => { throw new Error('복구 확인 resolver가 등록되지 않았습니다.'); };
  const watchdog = createWatchdog(scheduler, () => {
    checks += 1;
    return new Promise<SequenceRecoveryCheckResult>((resolve) => {
      resolveCheck = resolve;
    });
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(5000);
  assert.equal(checks, 1);

  watchdog.notifySnapshot();
  resolveCheck('unchanged');
  await Promise.resolve();
  await Promise.resolve();
  await scheduler.advanceBy(4999);
  assert.equal(checks, 1);
  await scheduler.advanceBy(1);
  assert.equal(checks, 2);
});

test('다른 복구 흐름 때문에 deferred되면 재시도 횟수를 소모하지 않고 5초 뒤 다시 확인한다', async () => {
  const scheduler = new FakeScheduler();
  let checks = 0;
  const watchdog = createWatchdog(scheduler, async () => {
    checks += 1;
    return checks < 3 ? 'deferred' : 'unchanged';
  });

  watchdog.update({ active: true, key: 'room-a:remote-turn-1' });
  await scheduler.advanceBy(5000);
  await scheduler.advanceBy(5000);
  await scheduler.advanceBy(5000);
  assert.equal(checks, 3);

  await scheduler.advanceBy(5000);
  assert.equal(checks, 4);
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
