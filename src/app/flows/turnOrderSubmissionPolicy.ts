import type { TurnOrderSubmissionSource } from './turnOrderFlow';

export const shouldReleaseTurnOrderSubmissionLockAfterFailure = (source: TurnOrderSubmissionSource) => source === 'manual';
