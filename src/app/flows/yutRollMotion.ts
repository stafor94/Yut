import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  ROLL_INTRO_EXTENSION_MS,
  clampUnit,
  smoothStep,
} from './yutRollAnimation';

export const MAX_TOTAL_SPIN_TURNS = 3;
export const LOCAL_THROW_APEX_PROGRESS = 0.48;
export const LOCAL_LANDING_IMPACT_PROGRESS = 0.38;
export const FALL_ON_MAT_ROLL_END_PROGRESS = 0.72;
export const FALL_EXIT_START_PROGRESS = 0.68;
export const PRIMARY_SPIN_TURNS_BASE = 1.8;
export const PRIMARY_SPIN_TURNS_STEP = 0.08;
export const EXTRA_SPIN_RADIANS_PER_SECOND_BASE = 0;
export const EXTRA_SPIN_RADIANS_PER_SECOND_STEP = 0;
export const LANDING_FLIGHT_SPIN_TURNS_BASE = 0.72;
export const LANDING_FLIGHT_SPIN_TURNS_STEP = 0.06;
export const REMOTE_ROLL_LOCAL_TIMELINE_START_MS = Math.max(
  0,
  LOCAL_ROLL_PRE_RESULT_MS / 2 - ROLL_INTRO_EXTENSION_MS,
);
export const REMOTE_ROLL_LOCAL_TIMELINE_OFFSET_MS = REMOTE_ROLL_LOCAL_TIMELINE_START_MS;
export const REMOTE_ROLL_LANDING_START_MS = Math.max(
  0,
  REMOTE_ROLL_LOCAL_TIMELINE_START_MS - LOCAL_ROLL_PRIMARY_MS,
);

const LANDING_DROP_INITIAL_SLOPE = 0.92;

export type LandingMotion = {
  flightProgress: number;
  dropProgress: number;
  settleProgress: number;
  slideProgress: number;
  bounceHeight: number;
  wobbleRadians: number;
  rollOffsetX: number;
  rollOffsetZ: number;
};

export type FallLandingMotion = {
  onMatRollProgress: number;
  exitProgress: number;
  bounceScale: number;
};

const getPeakY = (index: number) => 4.08 + index * 0.06;
const getPrimaryEndY = (index: number) => 2.55 + index * 0.05;

export function getPrimaryHorizontalProgress(progress: number) {
  const normalized = clampUnit(progress);
  return normalized * (0.74 + 0.26 * normalized);
}

export function getPrimaryThrowHeight(startY: number, progress: number, index: number) {
  const normalized = clampUnit(progress);
  const peakY = getPeakY(index);
  const endY = getPrimaryEndY(index);

  if (normalized <= LOCAL_THROW_APEX_PROGRESS) {
    const riseProgress = normalized / LOCAL_THROW_APEX_PROGRESS;
    const forcefulRise = 1 - Math.pow(1 - riseProgress, 3);
    return startY + (peakY - startY) * forcefulRise;
  }

  const descentProgress = (normalized - LOCAL_THROW_APEX_PROGRESS) / (1 - LOCAL_THROW_APEX_PROGRESS);
  const landingStartSlope = -endY
    * LANDING_DROP_INITIAL_SLOPE
    / LOCAL_LANDING_IMPACT_PROGRESS
    * LOCAL_ROLL_PRIMARY_MS
    / LOCAL_ROLL_LANDING_MS;
  const segmentEndSlope = landingStartSlope * (1 - LOCAL_THROW_APEX_PROGRESS);
  const t2 = descentProgress * descentProgress;
  const t3 = t2 * descentProgress;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * peakY + h01 * endY + h11 * segmentEndSlope;
}

export function getContinuousLandingDropProgress(progress: number) {
  const normalized = clampUnit(progress);
  return normalized * (LANDING_DROP_INITIAL_SLOPE + (1 - LANDING_DROP_INITIAL_SLOPE) * normalized);
}

export function getFallLandingMotion(progress: number): FallLandingMotion {
  const normalized = clampUnit(progress);
  const onMatRollProgress = smoothStep(clampUnit(
    (normalized - LOCAL_LANDING_IMPACT_PROGRESS)
      / (FALL_ON_MAT_ROLL_END_PROGRESS - LOCAL_LANDING_IMPACT_PROGRESS),
  ));
  const exitProgress = smoothStep(clampUnit(
    (normalized - FALL_EXIT_START_PROGRESS) / (1 - FALL_EXIT_START_PROGRESS),
  ));
  return {
    onMatRollProgress,
    exitProgress,
    bounceScale: 1 - exitProgress,
  };
}

export function getLandingMotion(progress: number, index: number): LandingMotion {
  const normalized = clampUnit(progress);
  const flightProgress = clampUnit(normalized / LOCAL_LANDING_IMPACT_PROGRESS);
  const settleProgress = clampUnit(
    (normalized - LOCAL_LANDING_IMPACT_PROGRESS) / (1 - LOCAL_LANDING_IMPACT_PROGRESS),
  );
  const firstBounceProgress = clampUnit(settleProgress / 0.62);
  const secondBounceProgress = clampUnit((settleProgress - 0.48) / 0.52);
  const firstBounce = settleProgress > 0 && firstBounceProgress < 1
    ? Math.sin(firstBounceProgress * Math.PI) * 0.42 * (1 - firstBounceProgress * 0.38)
    : 0;
  const secondBounce = settleProgress > 0.48 && secondBounceProgress < 1
    ? Math.sin(secondBounceProgress * Math.PI) * 0.16 * (1 - secondBounceProgress)
    : 0;
  const direction = index % 2 === 0 ? -1 : 1;
  const depthDirection = index % 3 === 0 ? -1 : 1;

  return {
    flightProgress,
    dropProgress: getContinuousLandingDropProgress(flightProgress),
    settleProgress,
    slideProgress: smoothStep(settleProgress),
    bounceHeight: firstBounce + secondBounce,
    wobbleRadians: Math.sin(settleProgress * Math.PI * 3.1) * (1 - settleProgress) * 0.62,
    rollOffsetX: direction * (0.22 + index * 0.018),
    rollOffsetZ: depthDirection * (0.09 + (index % 2) * 0.024),
  };
}

export function getRemoteTimelineElapsedMs(remoteElapsedMs: number) {
  const remoteProgress = clampUnit(remoteElapsedMs / REMOTE_ROLL_PRE_RESULT_MS);
  return REMOTE_ROLL_LOCAL_TIMELINE_START_MS
    + (LOCAL_ROLL_PRE_RESULT_MS - REMOTE_ROLL_LOCAL_TIMELINE_START_MS) * remoteProgress;
}

export function getRemoteLandingElapsedMs(remoteElapsedMs: number) {
  return Math.min(
    LOCAL_ROLL_LANDING_MS,
    Math.max(0, getRemoteTimelineElapsedMs(remoteElapsedMs) - LOCAL_ROLL_PRIMARY_MS),
  );
}
