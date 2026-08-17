import type { RollTimingZone, YutResultName } from '../../game-core/roll';
import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
} from './yutRollAnimation';
import {
  LOCAL_LANDING_IMPACT_PROGRESS,
  REMOTE_ROLL_LOCAL_TIMELINE_START_MS,
  getRemoteRollMotionElapsedMs,
} from './yutRollMotion';

export type RollSoundState = {
  phase?: 'primary' | 'extra-spin' | 'landing' | 'result-hold' | 'resolved';
  resultName?: YutResultName;
  fallCount?: number;
  timingZone?: RollTimingZone;
  turnOrder?: boolean;
  animationStartedAt?: number;
  resultRevealAt?: number;
};

export const isRollResultVisibleForSound = (state: RollSoundState) => {
  if (!state.resultName) return false;
  return state.phase !== 'primary' && state.phase !== 'extra-spin' && state.phase !== 'landing';
};

export const ROLL_LANDING_SOUND_LEAD_MS = 40;
export const ROLL_LANDING_IMPACT_ELAPSED_MS = Math.round(LOCAL_ROLL_LANDING_MS * LOCAL_LANDING_IMPACT_PROGRESS);
export const ROLL_LANDING_SOUND_DELAY_MS = Math.max(0, ROLL_LANDING_IMPACT_ELAPSED_MS - ROLL_LANDING_SOUND_LEAD_MS);
export const REMOTE_ROLL_LANDING_SOUND_DELAY_MS = Math.max(
  0,
  Math.round(
    ((LOCAL_ROLL_PRIMARY_MS + ROLL_LANDING_IMPACT_ELAPSED_MS - REMOTE_ROLL_LOCAL_TIMELINE_START_MS)
      / (LOCAL_ROLL_PRE_RESULT_MS - REMOTE_ROLL_LOCAL_TIMELINE_START_MS))
      * REMOTE_ROLL_PRE_RESULT_MS,
  ) - ROLL_LANDING_SOUND_LEAD_MS,
);

const hasAuthoritativeResultRevealAt = (state: RollSoundState) => Number.isFinite(state.resultRevealAt)
  && Number(state.resultRevealAt) > 0;

export const getRollLandingSoundDelayMs = (state: RollSoundState, animationId: number, nowMs = Date.now()) => {
  const animationStartedAt = Number.isFinite(state.animationStartedAt)
    ? Number(state.animationStartedAt)
    : animationId;
  const animationAgeMs = Number.isFinite(animationStartedAt) ? Math.max(0, nowMs - animationStartedAt) : 0;
  if (state.phase === 'primary' || state.phase === 'extra-spin') return null;
  if (state.phase === 'landing') {
    const landingElapsedMs = Math.max(0, animationAgeMs - LOCAL_ROLL_PRIMARY_MS);
    return Math.max(0, ROLL_LANDING_SOUND_DELAY_MS - landingElapsedMs);
  }
  if (state.phase === 'result-hold') return 0;

  const remoteElapsedMs = getRemoteRollMotionElapsedMs(
    animationStartedAt,
    state.resultRevealAt,
    nowMs,
  );
  if (remoteElapsedMs >= REMOTE_ROLL_LANDING_SOUND_DELAY_MS) return 0;
  if (!hasAuthoritativeResultRevealAt(state)) {
    return Math.max(0, REMOTE_ROLL_LANDING_SOUND_DELAY_MS - remoteElapsedMs);
  }

  const remainingRemoteMs = Math.max(0, REMOTE_ROLL_PRE_RESULT_MS - remoteElapsedMs);
  const remainingWallMs = Math.max(0, Number(state.resultRevealAt) - nowMs);
  if (remainingRemoteMs <= 0 || remainingWallMs <= 0) return 0;
  return Math.max(
    0,
    remainingWallMs
      * (REMOTE_ROLL_LANDING_SOUND_DELAY_MS - remoteElapsedMs)
      / remainingRemoteMs,
  );
};

export const getRollLandingSoundEffect = (state: RollSoundState): 'roll' | 'fall' | null => {
  if (state.turnOrder) return null;
  return 'roll';
};

export const getRollOutcomeSoundEffect = (state: RollSoundState): 'bonus' | null => {
  if (state.turnOrder || !isRollResultVisibleForSound(state)) return null;
  if ((state.fallCount ?? 0) > 0) return null;
  return state.resultName === '윷' || state.resultName === '모' ? 'bonus' : null;
};

export const shouldPlayPerfectRollSound = (state: RollSoundState) => state.timingZone === 'perfect' && !state.turnOrder;
