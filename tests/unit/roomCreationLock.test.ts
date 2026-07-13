import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForRoomCreationLock } from '../../src/features/room/services/roomCreationLock.js';

test('방 생성 잠금을 즉시 획득하면 재대기하지 않는다', async () => {
  let attempts = 0;
  let sleeps = 0;

  const acquired = await waitForRoomCreationLock({
    tryAcquire: async () => {
      attempts += 1;
      return true;
    },
    sleep: async () => {
      sleeps += 1;
    },
  });

  assert.equal(acquired, true);
  assert.equal(attempts, 1);
  assert.equal(sleeps, 0);
});

test('다른 요청이 잠금을 해제하면 제한 시간 안에서 재시도해 획득한다', async () => {
  let currentTime = 0;
  let attempts = 0;
  const delays: number[] = [];

  const acquired = await waitForRoomCreationLock({
    tryAcquire: async () => {
      attempts += 1;
      return attempts >= 3;
    },
    timeoutMs: 1_000,
    retryIntervalMs: 200,
    now: () => currentTime,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      currentTime += delayMs;
    },
  });

  assert.equal(acquired, true);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [200, 200]);
});

test('잠금이 계속 유지되면 지정한 제한 시간을 넘기지 않고 실패한다', async () => {
  let currentTime = 0;
  let attempts = 0;
  const delays: number[] = [];

  const acquired = await waitForRoomCreationLock({
    tryAcquire: async () => {
      attempts += 1;
      return false;
    },
    timeoutMs: 450,
    retryIntervalMs: 200,
    now: () => currentTime,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      currentTime += delayMs;
    },
  });

  assert.equal(acquired, false);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [200, 200, 50]);
  assert.equal(currentTime, 450);
});
