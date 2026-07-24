import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldReleaseTurnOrderSubmissionLockAfterFailure,
  shouldResetTurnOrderSubmissionLockForRound,
} from '../../src/app/flows/turnOrderSubmissionPolicy.js';

test('직접 제출 실패만 같은 라운드에서 재시도할 수 있도록 잠금을 해제한다', () => {
  assert.equal(shouldReleaseTurnOrderSubmissionLockAfterFailure('manual'), true);
  assert.equal(shouldReleaseTurnOrderSubmissionLockAfterFailure('auto'), false);
});

test('자동 제출 실패 잠금은 같은 라운드에서 유지하고 다음 라운드에서만 초기화한다', () => {
  assert.equal(shouldResetTurnOrderSubmissionLockForRound('round-1', 'round-1'), false);
  assert.equal(shouldResetTurnOrderSubmissionLockForRound('round-1', 'round-2'), true);
  assert.equal(shouldResetTurnOrderSubmissionLockForRound('', 'round-1'), false);
});
