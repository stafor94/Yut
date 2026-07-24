import type { TurnOrderSubmissionSource } from './turnOrderFlow';

export const shouldReleaseTurnOrderSubmissionLockAfterFailure = (source: TurnOrderSubmissionSource) => source === 'manual';

export const shouldResetTurnOrderSubmissionLockForRound = (lockedRoundId: string, currentRoundId: string) => Boolean(
  lockedRoundId
  && lockedRoundId !== currentRoundId,
);
