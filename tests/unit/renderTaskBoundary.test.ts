import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForNextRenderTask } from '../../src/app/flows/renderTaskBoundary.js';

test('다음 task에서도 시계가 같으면 다시 대기하고 증가한 뒤에만 완료한다', async () => {
  let currentTime = 1_000;
  const scheduledCallbacks: Array<() => void> = [];
  let settled = false;

  const boundary = waitForNextRenderTask({
    now: () => currentTime,
    schedule: (callback) => { scheduledCallbacks.push(callback); },
  }).then(() => { settled = true; });

  assert.equal(scheduledCallbacks.length, 1);
  scheduledCallbacks.shift()?.();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(scheduledCallbacks.length, 1);

  currentTime = 1_001;
  scheduledCallbacks.shift()?.();
  await boundary;
  assert.equal(settled, true);
  assert.equal(scheduledCallbacks.length, 0);
});
