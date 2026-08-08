import assert from 'node:assert/strict';
import test from 'node:test';
import { startAuthSession } from '../../src/app/flows/authSessionInitialization';

type TestUser = { uid: string };

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

test('저장된 인증 사용자를 확인하기 전에는 새 익명 로그인을 시작하지 않는다', async () => {
  let authStateCallback: ((user: TestUser | null) => void) | undefined;
  let signInCount = 0;
  let restoreCount = 0;
  let unsubscribed = false;
  const observedUsers: Array<TestUser | null> = [];

  const stop = startAuthSession<TestUser>({
    listenAuthState: (callback) => {
      authStateCallback = callback;
      return () => { unsubscribed = true; };
    },
    signInAsGuest: async () => {
      signInCount += 1;
      return { uid: 'new-guest' };
    },
    restoreUser: async () => { restoreCount += 1; },
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => assert.fail(`예상하지 못한 인증 오류: ${String(error)}`),
  });

  assert.equal(signInCount, 0);
  authStateCallback?.({ uid: 'restored-user' });
  await flushPromises();

  assert.equal(signInCount, 0);
  assert.equal(restoreCount, 0);
  assert.deepEqual(observedUsers, [{ uid: 'restored-user' }]);
  stop();
  assert.equal(unsubscribed, true);
});

test('첫 인증 상태가 null일 때만 익명 로그인을 한 번 시작한다', async () => {
  let authStateCallback: ((user: TestUser | null) => void) | undefined;
  let signInCount = 0;
  const observedUsers: Array<TestUser | null> = [];

  const stop = startAuthSession<TestUser>({
    listenAuthState: (callback) => {
      authStateCallback = callback;
      return () => undefined;
    },
    signInAsGuest: async () => {
      signInCount += 1;
      return { uid: 'guest-user' };
    },
    restoreUser: async () => undefined,
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => assert.fail(`예상하지 못한 인증 오류: ${String(error)}`),
  });

  authStateCallback?.(null);
  authStateCallback?.(null);
  await flushPromises();

  assert.equal(signInCount, 1);
  assert.deepEqual(observedUsers, [null, null, { uid: 'guest-user' }]);
  stop();
});

test('확립된 인증 사용자가 후속 null이 되면 같은 사용자를 한 번만 SDK에 복원한다', async () => {
  let authStateCallback: ((user: TestUser | null) => void) | undefined;
  let resolveRestore: (() => void) | undefined;
  let signInCount = 0;
  let restoreCount = 0;
  let restoredUser: TestUser | null = null;
  const observedUsers: Array<TestUser | null> = [];

  const stop = startAuthSession<TestUser>({
    listenAuthState: (callback) => {
      authStateCallback = callback;
      return () => undefined;
    },
    signInAsGuest: async () => {
      signInCount += 1;
      return { uid: 'replacement-guest' };
    },
    restoreUser: (user) => {
      restoreCount += 1;
      restoredUser = user;
      return new Promise<void>((resolve) => { resolveRestore = resolve; });
    },
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => assert.fail(`예상하지 못한 인증 오류: ${String(error)}`),
  });

  authStateCallback?.({ uid: 'restored-user' });
  authStateCallback?.(null);
  authStateCallback?.(null);

  assert.equal(signInCount, 0);
  assert.equal(restoreCount, 1);
  assert.deepEqual(restoredUser, { uid: 'restored-user' });
  assert.deepEqual(observedUsers, [{ uid: 'restored-user' }]);

  resolveRestore?.();
  await flushPromises();
  stop();
});

test('같은 사용자 SDK 복원에 실패하면 인증 상태를 비우고 오류를 전달한다', async () => {
  let authStateCallback: ((user: TestUser | null) => void) | undefined;
  const observedUsers: Array<TestUser | null> = [];
  const observedErrors: unknown[] = [];

  const stop = startAuthSession<TestUser>({
    listenAuthState: (callback) => {
      authStateCallback = callback;
      return () => undefined;
    },
    signInAsGuest: async () => ({ uid: 'guest-user' }),
    restoreUser: async () => { throw new Error('restore-failed'); },
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => observedErrors.push(error),
  });

  authStateCallback?.({ uid: 'restored-user' });
  authStateCallback?.(null);
  await flushPromises();

  assert.deepEqual(observedUsers, [{ uid: 'restored-user' }, null]);
  assert.equal(observedErrors.length, 1);
  assert.match(String(observedErrors[0]), /restore-failed/);
  stop();
});

test('구독 해제 뒤 완료된 익명 로그인은 사용자 상태를 다시 쓰지 않는다', async () => {
  let authStateCallback: ((user: TestUser | null) => void) | undefined;
  let resolveGuest: ((user: TestUser | null) => void) | undefined;
  const observedUsers: Array<TestUser | null> = [];

  const stop = startAuthSession<TestUser>({
    listenAuthState: (callback) => {
      authStateCallback = callback;
      return () => undefined;
    },
    signInAsGuest: () => new Promise<TestUser | null>((resolve) => {
      resolveGuest = resolve;
    }),
    restoreUser: async () => undefined,
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => assert.fail(`예상하지 못한 인증 오류: ${String(error)}`),
  });

  authStateCallback?.(null);
  stop();
  resolveGuest?.({ uid: 'late-guest' });
  await flushPromises();

  assert.deepEqual(observedUsers, [null]);
});