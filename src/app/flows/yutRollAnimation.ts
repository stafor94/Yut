export type YutRollScenePhase = 'primary' | 'extra-spin' | 'landing' | 'result-hold' | 'resolved';

export const ROLL_INTRO_EXTENSION_MS = 1000;
export const LOCAL_ROLL_PRIMARY_MS = 2200;
export const LOCAL_ROLL_LANDING_MS = 1700;
export const LOCAL_ROLL_PRE_RESULT_MS = LOCAL_ROLL_PRIMARY_MS + LOCAL_ROLL_LANDING_MS;
export const REMOTE_ROLL_PRE_RESULT_MS = 2200;

export const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
export const easeOutCubic = (value: number) => 1 - Math.pow(1 - clampUnit(value), 3);
export const easeInCubic = (value: number) => Math.pow(clampUnit(value), 3);
export const smoothStep = (value: number) => {
  const normalized = clampUnit(value);
  return normalized * normalized * (3 - 2 * normalized);
};

export const getLocalLandingDropProgress = (value: number) => {
  const normalized = clampUnit(value);
  return normalized * (0.22 + 0.78 * normalized);
};

export const isTerminalLiveRollPhase = (phase?: YutRollScenePhase) => phase === 'result-hold';

export const getYutRollPreResultDurationMs = (phase?: YutRollScenePhase) =>
  phase === 'primary' || phase === 'extra-spin' || phase === 'landing'
    ? LOCAL_ROLL_PRE_RESULT_MS
    : REMOTE_ROLL_PRE_RESULT_MS;
