declare const window: { [key: string]: unknown } | undefined;

type QaDelayKey = '__YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__' | '__YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__' | '__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__';

export const getQaDelayMs = (key: QaDelayKey) => {
  if (typeof window === 'undefined') return 0;
  const value = Number(window[key] ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
};

export const getQaRequestRoomGameStartDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__');
export const getQaInitializeGameStateDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__');
export const getQaRollYutActionDelayMs = () => getQaDelayMs('__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__');
