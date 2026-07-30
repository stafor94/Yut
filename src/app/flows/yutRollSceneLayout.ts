import { normalizeRollTimingZone, type RollTimingZone } from '../../game-core/roll';

export type YutRollSceneFraming = {
  aspect: number;
  cameraY: number;
  cameraZ: number;
  targetY: number;
  targetZ: number;
  distanceScale: number;
};

export type YutRollMatWorldBounds = {
  leftX: number;
  rightX: number;
  targetZ: number;
};

export type YutRollFallTarget = {
  side: -1 | 1;
  edgeX: number;
  x: number;
  y: number;
  z: number;
};

export type YutRollLandingProfile = 'centered' | 'offset' | 'scattered';

export type YutRollLandingTarget = {
  profile: YutRollLandingProfile;
  x: number;
  z: number;
  cssX: number;
  cssY: number;
};

const MIN_VIEWPORT_SIZE = 1;
const BASE_ASPECT = 1.42;
const BASE_TARGET_Y = 1.42;
const BASE_TARGET_Z = -0.02;
const BASE_CAMERA_OFFSET_Y = 4.45;
const BASE_CAMERA_OFFSET_Z = 7.35;
const CAMERA_FOV_DEGREES = 36;
const DEFAULT_SURFACE_LEFT_RATIO = 0.2;
const DEFAULT_SURFACE_RIGHT_RATIO = 0.8;
const FALL_TARGET_Z = -0.18;
const FALL_EXIT_CLEARANCE = 0.92;
const LANDING_EDGE_CLEARANCE = 0.38;
const CENTERED_LANDING_TARGETS = [
  { x: -1.32, z: -0.24 },
  { x: -0.44, z: 0 },
  { x: 0.44, z: -0.24 },
  { x: 1.32, z: 0 },
] as const;
const SCATTERED_LANDING_TARGETS = [
  { x: -1.64, z: -0.52, cssX: -22, cssY: 18 },
  { x: -0.58, z: 0.34, cssX: -10, cssY: -14 },
  { x: 0.62, z: 0.44, cssX: 12, cssY: -22 },
  { x: 1.6, z: -0.34, cssX: 20, cssY: 14 },
] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeIndex = (index: number) => Math.abs(Math.trunc(Number.isFinite(index) ? index : 0)) % 4;

export function getYutRollLandingProfile(zone: RollTimingZone = 'normal'): YutRollLandingProfile {
  const grade = normalizeRollTimingZone(zone);
  if (grade === 'good') return 'offset';
  if (grade === 'bad' && zone !== 'normal') return 'scattered';
  return 'centered';
}

export function getYutRollLandingTarget(
  index: number,
  zone: RollTimingZone = 'normal',
  bounds?: YutRollMatWorldBounds,
): YutRollLandingTarget {
  const normalizedIndex = normalizeIndex(index);
  const profile = getYutRollLandingProfile(zone);
  const centered = CENTERED_LANDING_TARGETS[normalizedIndex];
  const candidate = profile === 'offset'
    ? { x: centered.x + 0.34, z: centered.z, cssX: 24, cssY: -4 }
    : profile === 'scattered'
      ? SCATTERED_LANDING_TARGETS[normalizedIndex]
      : { ...centered, cssX: 0, cssY: 0 };
  const minimumX = bounds ? bounds.leftX + LANDING_EDGE_CLEARANCE : Number.NEGATIVE_INFINITY;
  const maximumX = bounds ? bounds.rightX - LANDING_EDGE_CLEARANCE : Number.POSITIVE_INFINITY;
  return {
    profile,
    x: clamp(candidate.x, minimumX, maximumX),
    z: candidate.z,
    cssX: candidate.cssX,
    cssY: candidate.cssY,
  };
}

export function getYutRollSceneFraming(width: number, height: number): YutRollSceneFraming {
  const safeWidth = Math.max(MIN_VIEWPORT_SIZE, Number.isFinite(width) ? width : MIN_VIEWPORT_SIZE);
  const safeHeight = Math.max(MIN_VIEWPORT_SIZE, Number.isFinite(height) ? height : MIN_VIEWPORT_SIZE);
  const aspect = safeWidth / safeHeight;
  const narrowViewportScale = Math.max(1, BASE_ASPECT / aspect);
  const compactViewportScale = safeWidth < 520 ? 1.05 : 1;
  const distanceScale = Math.min(1.48, narrowViewportScale * compactViewportScale);

  return {
    aspect,
    cameraY: BASE_TARGET_Y + BASE_CAMERA_OFFSET_Y * distanceScale,
    cameraZ: BASE_TARGET_Z + BASE_CAMERA_OFFSET_Z * distanceScale,
    targetY: BASE_TARGET_Y,
    targetZ: BASE_TARGET_Z,
    distanceScale,
  };
}

export function getYutRollMatWorldBounds(
  width: number,
  height: number,
  surfaceLeftPx: number,
  surfaceRightPx: number,
  targetZ = FALL_TARGET_Z,
): YutRollMatWorldBounds {
  const safeWidth = Math.max(MIN_VIEWPORT_SIZE, Number.isFinite(width) ? width : MIN_VIEWPORT_SIZE);
  const safeHeight = Math.max(MIN_VIEWPORT_SIZE, Number.isFinite(height) ? height : MIN_VIEWPORT_SIZE);
  const defaultLeft = safeWidth * DEFAULT_SURFACE_LEFT_RATIO;
  const defaultRight = safeWidth * DEFAULT_SURFACE_RIGHT_RATIO;
  const resolvedLeft = Number.isFinite(surfaceLeftPx) ? surfaceLeftPx : defaultLeft;
  const resolvedRight = Number.isFinite(surfaceRightPx) ? surfaceRightPx : defaultRight;
  const leftPx = clamp(Math.min(resolvedLeft, resolvedRight), 0, safeWidth);
  const rightPx = clamp(Math.max(resolvedLeft, resolvedRight), leftPx, safeWidth);
  const framing = getYutRollSceneFraming(safeWidth, safeHeight);
  const forwardY = framing.targetY - framing.cameraY;
  const forwardZ = framing.targetZ - framing.cameraZ;
  const forwardLength = Math.max(0.001, Math.hypot(forwardY, forwardZ));
  const normalizedForwardY = forwardY / forwardLength;
  const normalizedForwardZ = forwardZ / forwardLength;
  const depth = Math.max(
    0.1,
    (0 - framing.cameraY) * normalizedForwardY + (targetZ - framing.cameraZ) * normalizedForwardZ,
  );
  const halfWorldWidth = depth * Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360) * framing.aspect;
  const worldXAtPixel = (pixelX: number) => ((pixelX / safeWidth) * 2 - 1) * halfWorldWidth;

  return {
    leftX: worldXAtPixel(leftPx),
    rightX: worldXAtPixel(rightPx),
    targetZ,
  };
}

export function getYutRollFallTarget(index: number, bounds: YutRollMatWorldBounds): YutRollFallTarget {
  const normalizedIndex = normalizeIndex(index);
  const side = normalizedIndex % 2 === 0 ? -1 : 1;
  const edgeX = side < 0 ? bounds.leftX : bounds.rightX;
  const laneOffset = normalizedIndex >= 2 ? 0.16 : 0;

  return {
    side,
    edgeX,
    x: edgeX + side * (FALL_EXIT_CLEARANCE + laneOffset),
    y: -0.88 - (normalizedIndex % 2) * 0.08,
    z: -0.42 + normalizedIndex * 0.14,
  };
}
