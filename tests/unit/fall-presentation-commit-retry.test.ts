import assert from 'node:assert/strict';
import test from 'node:test';
import {
  settleFallPresentationCompletionWithRetry,
} from '../../src/features/room/services/fallPresentationCommitPolicy';

const completionAction = {
  type: 'roll_yut',
  actorId: 'seat-ai',
  payload: { completeFallPresentation: true },
};

test('낙 완료 커밋은 일시 거부 뒤 서비스 계층에서 다시 시도한다', async () => {
  const results = [{ status: 'rejected' }, { status: 'committed' }];
  const waits: number[] = [];
  let commitCount = 0;

  const result = await settleFallPresentationCompletionWithRetry({
    action: completionAction,
    commit: async () => results[Math.min(commitCount++, results.length - 1)]!,
    wait: async (delayMs) => { waits.push(delayMs); },
    retryDelayMs: 25,
    maxAttempts: 4,
  });

  assert.equal(result.status, 'committed');
  assert.equal(commitCount, 2);
  assert.deepEqual(waits, [25]);
});

test('낙 완료 커밋의 committed와 duplicate는 즉시 종료한다', async () => {
  for (const status of ['committed', 'duplicate']) {
    let commitCount = 0;
    let waitCount = 0;
    const result = await settleFallPresentationCompletionWithRetry({
      action: completionAction,
      commit: async () => { commitCount += 1; return { status }; },
      wait: async () => { waitCount += 1; },
    });

    assert.equal(result.status, status);
    assert.equal(commitCount, 1);
    assert.equal(waitCount, 0);
  }
});

test('계속 실패하면 지정된 최대 횟수까지만 재시도한다', async () => {
  let commitCount = 0;
  let waitCount = 0;

  const result = await settleFallPresentationCompletionWithRetry({
    action: completionAction,
    commit: async () => { commitCount += 1; return { status: 'rejected' }; },
    wait: async () => { waitCount += 1; },
    maxAttempts: 3,
  });

  assert.equal(result.status, 'rejected');
  assert.equal(commitCount, 3);
  assert.equal(waitCount, 2);
});

test('일반 윷 던지기는 재시도 정책을 적용하지 않는다', async () => {
  let commitCount = 0;
  let waitCount = 0;

  const result = await settleFallPresentationCompletionWithRetry({
    action: {
      type: 'roll_yut',
      actorId: 'seat-human',
      payload: { rollTimingZone: 'normal' },
    },
    commit: async () => { commitCount += 1; return { status: 'rejected' }; },
    wait: async () => { waitCount += 1; },
    maxAttempts: 6,
  });

  assert.equal(result.status, 'rejected');
  assert.equal(commitCount, 1);
  assert.equal(waitCount, 0);
});
