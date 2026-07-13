import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHORITATIVE_ITEM_TIMEOUT_REASON,
  AuthoritativeCommitTimeoutError,
  settleAuthoritativeCommit,
} from '../../src/features/room/services/authoritativeCommitTimeout';

test('authoritative 요청이 제한 시간 안에 끝나면 결과를 그대로 반환한다', async () => {
  const result = await settleAuthoritativeCommit({
    actionType: 'use_item',
    commit: async () => ({ status: 'committed' as const, sequence: 3, turnVersion: 3 }),
    timeoutMs: 20,
    recoveryTimeoutMs: 5,
  });

  assert.deepEqual(result, { status: 'committed', sequence: 3, turnVersion: 3 });
});

test('응답이 유실됐지만 서버 처리 기록이 있으면 duplicate로 복구한다', async () => {
  const result = await settleAuthoritativeCommit({
    actionType: 'place_trap',
    commit: () => new Promise<{ status: 'committed'; sequence: number; turnVersion: number }>(() => undefined),
    recoverProcessed: async () => ({ sequence: 9, turnVersion: 12 }),
    timeoutMs: 5,
    recoveryTimeoutMs: 10,
  });

  assert.deepEqual(result, { status: 'duplicate', sequence: 9, turnVersion: 12 });
});

test('처리 기록이 없는 아이템 요청 timeout은 rejected로 반환해 pending 정리와 재동기화를 유도한다', async () => {
  const result = await settleAuthoritativeCommit({
    actionType: 'item_pickup_decision',
    commit: () => new Promise<{ status: 'committed' }>(() => undefined),
    recoverProcessed: async () => null,
    timeoutMs: 5,
    recoveryTimeoutMs: 5,
  });

  assert.deepEqual(result, { status: 'rejected', reason: AUTHORITATIVE_ITEM_TIMEOUT_REASON });
});

test('처리 기록 조회도 멈추면 제한 시간 뒤 아이템 요청을 rejected로 정리한다', async () => {
  const result = await settleAuthoritativeCommit({
    actionType: 'use_item',
    commit: () => new Promise<{ status: 'committed' }>(() => undefined),
    recoverProcessed: () => new Promise<null>(() => undefined),
    timeoutMs: 5,
    recoveryTimeoutMs: 5,
  });

  assert.deepEqual(result, { status: 'rejected', reason: AUTHORITATIVE_ITEM_TIMEOUT_REASON });
});

test('아이템 외 요청 timeout은 오류를 유지해 기존 액션별 복구 경로가 처리하게 한다', async () => {
  await assert.rejects(
    settleAuthoritativeCommit({
      actionType: 'roll_yut',
      commit: () => new Promise<{ status: 'committed' }>(() => undefined),
      timeoutMs: 5,
      recoveryTimeoutMs: 5,
    }),
    (error: unknown) => error instanceof AuthoritativeCommitTimeoutError && error.actionType === 'roll_yut',
  );
});

test('멈춘 아이템 요청 뒤에 직렬화된 다음 요청이 계속 실행된다', async () => {
  let queue = Promise.resolve();
  const first = queue.then(() => settleAuthoritativeCommit({
    actionType: 'use_item',
    commit: () => new Promise<{ status: 'committed' }>(() => undefined),
    recoverProcessed: async () => null,
    timeoutMs: 5,
    recoveryTimeoutMs: 5,
  }));
  queue = first.then(() => undefined, () => undefined);
  const second = queue.then(() => 'next-action-started');

  assert.equal((await first).status, 'rejected');
  assert.equal(await second, 'next-action-started');
});
