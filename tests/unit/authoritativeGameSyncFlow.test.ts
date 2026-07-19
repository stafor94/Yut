import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthoritativeGameActionQueues } from '../../src/app/flows/authoritativeGameSyncFlow.js';

const waitImmediate = () => new Promise<void>((resolve) => setImmediate(resolve));

test('commit queue는 첫 commit 실패 후에도 다음 commit을 순차 실행한다', async () => {
  const order: string[] = [];
  const queues = createAuthoritativeGameActionQueues<string, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async (_roomId, action) => {
      order.push(`start:${action}`);
      await waitImmediate();
      order.push(`end:${action}`);
      if (action === 'a') throw new Error('첫 commit 실패');
      return `result:${action}`;
    },
  });

  const first = queues.commitQueuedAuthoritativeGameAction('room-a', 'a').catch((error) => error instanceof Error ? error.message : 'unknown');
  const second = queues.commitQueuedAuthoritativeGameAction('room-a', 'b');

  assert.equal(await first, '첫 commit 실패');
  assert.equal(await second, 'result:b');
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b']);
});

test('apply queue는 순차 실행하고 room 변경 시 queued apply를 무시한다', async () => {
  const activeRoomIdRef = { current: 'room-a' };
  const order: string[] = [];
  const queues = createAuthoritativeGameActionQueues<string, string>({
    activeRoomIdRef,
    commit: async (_roomId, action) => `result:${action}`,
  });

  const first = queues.enqueueAuthoritativeResultApplication('room-a', async () => {
    order.push('first:start');
    activeRoomIdRef.current = 'room-b';
    await waitImmediate();
    order.push('first:end');
    return 'first';
  });
  const second = queues.enqueueAuthoritativeResultApplication('room-a', () => {
    order.push('second');
    return 'second';
  });

  assert.equal(await first, 'first');
  assert.equal(await second, null);
  assert.deepEqual(order, ['first:start', 'first:end']);
});

test('apply 종료 알림은 성공값을 전달하고 실패와 stale room 경로에서도 원래 결과를 보존한다', async () => {
  const activeRoomIdRef = { current: 'room-a' };
  const settled: Array<{ roomId: string; value: unknown }> = [];
  let staleApplyCalled = false;
  const queues = createAuthoritativeGameActionQueues<string, string>({
    activeRoomIdRef,
    commit: async (_roomId, action) => `result:${action}`,
    onApplySettled: (roomId, value) => { settled.push({ roomId, value }); },
  });

  const appliedState = { lastSequence: 2, roll: { name: '도', steps: 1 } };
  assert.deepEqual(await queues.enqueueAuthoritativeResultApplication('room-a', () => appliedState), appliedState);
  await assert.rejects(
    queues.enqueueAuthoritativeResultApplication('room-a', () => { throw new Error('apply failed'); }),
    /apply failed/,
  );
  activeRoomIdRef.current = 'room-b';
  assert.equal(await queues.enqueueAuthoritativeResultApplication('room-a', () => {
    staleApplyCalled = true;
    return 'stale';
  }), null);

  assert.equal(staleApplyCalled, false);
  assert.deepEqual(settled, [
    { roomId: 'room-a', value: appliedState },
    { roomId: 'room-a', value: undefined },
    { roomId: 'room-a', value: null },
  ]);
});

test('apply 종료 알림 오류는 authoritative 결과를 변경하지 않는다', async () => {
  const queues = createAuthoritativeGameActionQueues<string, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async (_roomId, action) => `result:${action}`,
    onApplySettled: () => { throw new Error('wake failed'); },
  });

  assert.equal(await queues.enqueueAuthoritativeResultApplication('room-a', () => 'applied'), 'applied');
});

test('enqueueAuthoritativeGameAction은 result/error/finally 순서를 보존한다', async () => {
  const successEvents: string[] = [];
  const successQueues = createAuthoritativeGameActionQueues<string, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async (_roomId, action) => `result:${action}`,
  });
  successQueues.enqueueAuthoritativeGameAction('room-a', 'ok', {
    handleResult: (result) => { successEvents.push(`result:${result}`); },
    handleError: () => { successEvents.push('error'); },
    handleFinally: () => { successEvents.push('finally'); },
  });
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(successEvents, ['result:result:ok', 'finally']);

  const errorEvents: string[] = [];
  const errorQueues = createAuthoritativeGameActionQueues<string, string>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async () => { throw new Error('boom'); },
  });
  errorQueues.enqueueAuthoritativeGameAction('room-a', 'bad', {
    handleResult: () => { errorEvents.push('result'); },
    handleError: (error) => { errorEvents.push(error instanceof Error ? `error:${error.message}` : 'error'); },
    handleFinally: () => { errorEvents.push('finally'); },
  });
  await waitImmediate();
  await waitImmediate();
  assert.deepEqual(errorEvents, ['error:boom', 'finally']);
});

test('queued action 적용 완료 알림은 handleResult가 끝난 뒤 commit 결과를 전달한다', async () => {
  const events: string[] = [];
  const commitResult = { sequence: 4, patch: { turnIndex: 1, roll: null } };
  const settledValues: unknown[] = [];
  const queues = createAuthoritativeGameActionQueues<string, typeof commitResult>({
    activeRoomIdRef: { current: 'room-a' },
    commit: async () => commitResult,
    onApplySettled: (_roomId, value) => { settledValues.push(value); },
  });

  queues.enqueueAuthoritativeGameAction('room-a', 'move', {
    handleResult: async () => {
      events.push('apply:start');
      await waitImmediate();
      events.push('apply:end');
    },
    handleError: () => { events.push('error'); },
    handleFinally: () => { events.push('finally'); },
  });

  await waitImmediate();
  await waitImmediate();
  await waitImmediate();

  assert.deepEqual(events, ['apply:start', 'apply:end', 'finally']);
  assert.deepEqual(settledValues, [commitResult]);
});
