import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldReleaseTurnOrderSubmissionLockAfterFailure } from '../../src/app/flows/turnOrderSubmissionPolicy.js';

test('직접 제출 실패만 같은 라운드에서 재시도할 수 있도록 잠금을 해제한다', () => {
  assert.equal(shouldReleaseTurnOrderSubmissionLockAfterFailure('manual'), true);
  assert.equal(shouldReleaseTurnOrderSubmissionLockAfterFailure('auto'), false);
});
