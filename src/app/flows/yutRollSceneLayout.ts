export type YutRollSceneFraming = {
  aspect: number;
  cameraY: number;
  cameraZ: number;
  targetY: number;
  targetZ: number;
  distanceScale: number;
};

const MIN_VIEWPORT_SIZE = 1;
const BASE_ASPECT = 1.42;
const BASE_TARGET_Y = 0.88;
const BASE_TARGET_Z = -0.02;
const BASE_CAMERA_OFFSET_Y = 4.45;
const BASE_CAMERA_OFFSET_Z = 7.35;

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
