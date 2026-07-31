declare const window: { [key: string]: unknown } | undefined;

type QaDelayKey = '__YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__' | '__YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__' | '__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__' | '__YUT_QA_DELAY_USE_ITEM_ACTION_MS__';

const timeoutRollCommitFailureCountByActionId = new Map<string, number>();

export const getQaDelayMs = (key: QaDelayKey) => {
  if (typeof window === 'undefined') return 0;
  const value = Number(window[key] ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

export const getQaRequestRoomGameStartDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__');
export const getQaInitializeGameStateDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__');
export const getQaRollYutActionDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__');
export const getQaUseItemActionDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_USE_ITEM_ACTION_MS__');

/** QA-only deterministic failure injection for verifying same-payload timeout retries and coordinator fallback. */
export const shouldFailQaTimeoutRollCommit = (clientActionId: string) => {
  if (typeof window === 'undefined' || !clientActionId) return false;
  const configuredFailureCount = Math.max(0, Math.trunc(Number(window.__YUT_QA_FAIL_TIMEOUT_ROLL_COMMIT_COUNT__ ?? 0)));
  if (!configuredFailureCount) return false;
  const attemptCount = Math.max(0, Math.trunc(Number(window.__YUT_QA_TIMEOUT_ROLL_COMMIT_ATTEMPTS__ ?? 0))) + 1;
  window.__YUT_QA_TIMEOUT_ROLL_COMMIT_ATTEMPTS__ = attemptCount;
  const failureCount = timeoutRollCommitFailureCountByActionId.get(clientActionId) ?? 0;
  if (failureCount >= configuredFailureCount) return false;
  timeoutRollCommitFailureCountByActionId.set(clientActionId, failureCount + 1);
  return true;
};
