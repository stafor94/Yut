import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRoomDeletionContentionError,
  retryRoomDeletionContention,
} from '../../src/features/room/services/roomDeletionRetry';

test('방 삭제 claim의 failed-precondition과 aborted만 복구 가능한 경쟁 오류로 분류한다', () => {
  assert.equal(isRoomDeletionContentionError({ code: 'failed-precondition' }), true);
  assert.equal(isRoomDeletionContentionError({ code: 'firestore/aborted' }), true);
  assert.equal(isRoomDeletionContentionError({ code: 'permission-denied' }), false);
  assert.equal(isRoomDeletionContentionError(new Error('failed-precondition')), false);
});

test('복구 가능한 방 삭제 경쟁 오류는 제한 횟수 안에서 재시도한다', async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryRoomDeletionContention(async () => {
    calls += 1;
    if (calls < 3) throw { code: 'failed-precondition' };
    return 'deleted';
  }, {
    maxAttempts: 3,
    delayMs: (attempt) => attempt * 25,
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  assert.equal(result, 'deleted');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [25, 50]);
});

test('복구 불가능한 오류는 재시도하지 않고 즉시 전달한다', async () => {
  let calls = 0;
  const failure = { code: 'permission-denied' };

  await assert.rejects(
    retryRoomDeletionContention(async () => {
      calls += 1;
      throw failure;
    }, { sleep: async () => undefined }),
    (error) => error === failure,
  );

  assert.equal(calls, 1);
});

test('복구 가능한 오류도 최대 재시도 횟수를 넘기지 않는다', async () => {
  let calls = 0;
  const failure = { code: 'aborted' };

  await assert.rejects(
    retryRoomDeletionContention(async () => {
      calls += 1;
      throw failure;
    }, { maxAttempts: 3, sleep: async () => undefined }),
    (error) => error === failure,
  );

  assert.equal(calls, 3);
});
