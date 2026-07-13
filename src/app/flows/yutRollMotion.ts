import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  clampUnit,
  smoothStep,
} from './yutRollAnimation';

export const LOCAL_THROW_APEX_PROGRESS = 0.48;
export const LOCAL_LANDING_IMPACT_PROGRESS = 0.62;
export const PRIMARY_SPIN_TURNS_BASE = 2.05;
export const PRIMARY_SPIN_TURNS_STEP = 0.175;
export const EXTRA_SPIN_RADIANS_PER_SECOND_BASE = 3.1;
export const EXTRA_SPIN_RADIANS_PER_SECOND_STEP = 0.24;
export const LANDING_FLIGHT_SPIN_TURNS_BASE = 0.86;
export const LANDING_FLIGHT_SPIN_TURNS_STEP = 0.11;
export const REMOTE_ROLL_LOCAL_TIMELINE_START_MS = LOCAL_ROLL_PRE_RESULT_MS / 2;
export const REMOTE_ROLL_LOCAL_TIMELINE_OFFSET_MS = REMOTE_ROLL_LOCAL_TIMELINE_START_MS;
export const REMOTE_ROLL_LANDING_START_MS = Math.max(
  0,
  REMOTE_ROLL_LOCAL_TIMELINE_START_MS - LOCAL_ROLL_PRIMARY_MS,
);

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
    * 0.72
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
  return normalized * (0.72 + 0.28 * normalized);
}

export function getLandingMotion(progress: number, index: number): LandingMotion {
  const normalized = clampUnit(progress);
  const flightProgress = clampUnit(normalized / LOCAL_LANDING_IMPACT_PROGRESS);
  const settleProgress = clampUnit(
    (normalized - LOCAL_LANDING_IMPACT_PROGRESS) / (1 - LOCAL_LANDING_IMPACT_PROGRESS),
  );
  const firstBounceProgress = clampUnit(settleProgress / 0.56);
  const secondBounceProgress = clampUnit((settleProgress - 0.52) / 0.48);
  const firstBounce = settleProgress > 0 && firstBounceProgress < 1
    ? Math.sin(firstBounceProgress * Math.PI) * 0.34 * (1 - firstBounceProgress * 0.45)
    : 0;
  const secondBounce = settleProgress > 0.52 && secondBounceProgress < 1
    ? Math.sin(secondBounceProgress * Math.PI) * 0.11 * (1 - secondBounceProgress)
    : 0;
  const direction = index % 2 === 0 ? -1 : 1;
  const depthDirection = index % 3 === 0 ? -1 : 1;

  return {
    flightProgress,
    dropProgress: getContinuousLandingDropProgress(flightProgress),
    settleProgress,
    slideProgress: smoothStep(settleProgress),
    bounceHeight: firstBounce + secondBounce,
    wobbleRadians: Math.sin(settleProgress * Math.PI * 2.35) * (1 - settleProgress) * 0.58,
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
