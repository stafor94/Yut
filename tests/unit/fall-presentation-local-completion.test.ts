import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveFallPresentationCompletionLocally,
  shouldWaitForGamePresentationBeforeCommit,
} from '../../src/features/room/services/fallPresentationCommitPolicy';

test('낙 presentation 완료 액션은 서버 commit 없이 로컬 duplicate로 종료한다', () => {
  const action = {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: { completeFallPresentation: true },
  };

  assert.deepEqual(resolveFallPresentationCompletionLocally(action), { status: 'duplicate' });
  assert.equal(shouldWaitForGamePresentationBeforeCommit(action), false);
});

test('일반 게임 액션은 로컬에서 소비하지 않는다', () => {
  const action = {
    type: 'roll_yut',
    actorId: 'seat-1',
    payload: { rollTimingZone: 'perfect' },
  };

  assert.equal(resolveFallPresentationCompletionLocally(action), null);
  assert.equal(shouldWaitForGamePresentationBeforeCommit(action), true);
});
