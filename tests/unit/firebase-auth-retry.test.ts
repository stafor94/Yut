import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFirebaseAuthErrorCode,
  isTransientFirebaseAuthError,
  retryFirebaseAuthOperation,
} from '../../src/services/firebase/firebaseAuthRetry.js';

const firebaseError = (code: string) => Object.assign(new Error(code), { code });

test('Firebase 인증의 일시 오류는 지정한 지연 후 재시도한다', async () => {
  let attempts = 0;
  const waits: number[] = [];
  const retries: Array<{ attempt: number; delayMs: number; code: string }> = [];

  const result = await retryFirebaseAuthOperation(async () => {
    attempts += 1;
    if (attempts < 3) throw firebaseError('auth/the-service-is-currently-unavailable');
    return 'signed-in';
  }, {
    retryDelaysMs: [10, 20, 30],
    wait: async (delayMs) => { waits.push(delayMs); },
    onRetry: ({ attempt, delayMs, error }) => retries.push({ attempt, delayMs, code: getFirebaseAuthErrorCode(error) }),
  });

  assert.equal(result, 'signed-in');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.deepEqual(retries, [
    { attempt: 1, delayMs: 10, code: 'auth/the-service-is-currently-unavailable' },
    { attempt: 2, delayMs: 20, code: 'auth/the-service-is-currently-unavailable' },
  ]);
});

test('설정 오류는 재시도하지 않고 즉시 전달한다', async () => {
  let attempts = 0;
  let waits = 0;
  const error = firebaseError('auth/operation-not-allowed');

  await assert.rejects(
    retryFirebaseAuthOperation(async () => {
      attempts += 1;
      throw error;
    }, {
      retryDelaysMs: [10, 20],
      wait: async () => { waits += 1; },
    }),
    error,
  );

  assert.equal(attempts, 1);
  assert.equal(waits, 0);
  assert.equal(isTransientFirebaseAuthError(error), false);
});

test('일시 오류가 계속되면 허용된 재시도 횟수 후 실패한다', async () => {
  let attempts = 0;
  const error = firebaseError('auth/network-request-failed');

  await assert.rejects(
    retryFirebaseAuthOperation(async () => {
      attempts += 1;
      throw error;
    }, {
      retryDelaysMs: [0, 0],
      wait: async () => undefined,
    }),
    error,
  );

  assert.equal(attempts, 3);
  assert.equal(isTransientFirebaseAuthError(error), true);
});
