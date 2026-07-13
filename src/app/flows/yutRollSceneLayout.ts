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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  const normalizedIndex = Math.abs(Math.trunc(Number.isFinite(index) ? index : 0)) % 4;
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
