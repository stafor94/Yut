import assert from 'node:assert/strict';
import test from 'node:test';
import { startAuthSession } from '../../src/app/flows/authSessionInitialization';

type TestUser = { uid: string };

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

test('저장된 인증 사용자를 확인하기 전에는 새 익명 로그인을 시작하지 않는다', async () => {
  let authStateCallback: ((user: TestUser | null) => void) | undefined;
  let signInCount = 0;
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
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => assert.fail(`예상하지 못한 인증 오류: ${String(error)}`),
  });

  assert.equal(signInCount, 0);
  authStateCallback?.({ uid: 'restored-user' });
  await flushPromises();

  assert.equal(signInCount, 0);
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

test('확립된 인증 사용자는 후속 null 이벤트로 지우거나 새 익명 로그인으로 교체하지 않는다', async () => {
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
      return { uid: 'replacement-guest' };
    },
  }, {
    onUser: (user) => observedUsers.push(user),
    onError: (error) => assert.fail(`예상하지 못한 인증 오류: ${String(error)}`),
  });

  authStateCallback?.({ uid: 'restored-user' });
  authStateCallback?.(null);
  await flushPromises();

  assert.equal(signInCount, 0);
  assert.deepEqual(observedUsers, [{ uid: 'restored-user' }]);
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
