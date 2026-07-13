import {
  LOCAL_ROLL_LANDING_MS,
  LOCAL_ROLL_PRE_RESULT_MS,
  LOCAL_ROLL_PRIMARY_MS,
  REMOTE_ROLL_PRE_RESULT_MS,
  clampUnit,
  smoothStep,
} from './yutRollAnimation';

export const LOCAL_THROW_APEX_PROGRESS = 0.82;
export const LOCAL_LANDING_IMPACT_PROGRESS = 0.76;
export const REMOTE_ROLL_LOCAL_TIMELINE_OFFSET_MS = LOCAL_ROLL_PRE_RESULT_MS - REMOTE_ROLL_PRE_RESULT_MS;
export const REMOTE_ROLL_LANDING_START_MS = Math.max(
  0,
  REMOTE_ROLL_LOCAL_TIMELINE_OFFSET_MS - LOCAL_ROLL_PRIMARY_MS,
);

type LandingMotion = {
  flightProgress: number;
  dropProgress: number;
  settleProgress: number;
  slideProgress: number;
  bounceHeight: number;
  wobbleRadians: number;
  rollOffsetX: number;
  rollOffsetZ: number;
};

export function getPrimaryThrowHeight(startY: number, progress: number, index: number) {
  const normalized = clampUnit(progress);
  const peakY = 3.34 + index * 0.07;
  const gravity = (peakY - startY) / (LOCAL_THROW_APEX_PROGRESS * LOCAL_THROW_APEX_PROGRESS);
  const launchVelocity = 2 * gravity * LOCAL_THROW_APEX_PROGRESS;
  return startY + launchVelocity * normalized - gravity * normalized * normalized;
}

export function getContinuousLandingDropProgress(progress: number) {
  const normalized = clampUnit(progress);
  return normalized * (0.68 + 0.32 * normalized);
}

export function getLandingMotion(progress: number, index: number): LandingMotion {
  const normalized = clampUnit(progress);
  const flightProgress = clampUnit(normalized / LOCAL_LANDING_IMPACT_PROGRESS);
  const settleProgress = clampUnit(
    (normalized - LOCAL_LANDING_IMPACT_PROGRESS) / (1 - LOCAL_LANDING_IMPACT_PROGRESS),
  );
  const firstBounceProgress = clampUnit(settleProgress / 0.58);
  const secondBounceProgress = clampUnit((settleProgress - 0.55) / 0.45);
  const firstBounce = settleProgress > 0
    ? Math.sin(firstBounceProgress * Math.PI) * 0.22 * (1 - firstBounceProgress)
    : 0;
  const secondBounce = settleProgress > 0.55
    ? Math.sin(secondBounceProgress * Math.PI) * 0.065 * (1 - secondBounceProgress)
    : 0;
  const direction = index % 2 === 0 ? -1 : 1;
  const depthDirection = index % 3 === 0 ? -1 : 1;

  return {
    flightProgress,
    dropProgress: getContinuousLandingDropProgress(flightProgress),
    settleProgress,
    slideProgress: smoothStep(settleProgress),
    bounceHeight: firstBounce + secondBounce,
    wobbleRadians: Math.sin(settleProgress * Math.PI * 2.2) * (1 - settleProgress) * 0.42,
    rollOffsetX: direction * (0.13 + index * 0.012),
    rollOffsetZ: depthDirection * (0.055 + (index % 2) * 0.018),
  };
}

export function getRemoteLandingElapsedMs(remoteElapsedMs: number) {
  return Math.min(
    LOCAL_ROLL_LANDING_MS,
    REMOTE_ROLL_LANDING_START_MS + Math.max(0, remoteElapsedMs),
  );
}
