export type HorizontalClientRect = {
  left: number;
  width: number;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const normalizeRollTimingPositionPercent = (value: number) => (
  Math.round(clampPercent(value) * 1000) / 1000
);

export const getRollTimingTrackTransform = (positionPercent: number) => (
  `translate3d(${normalizeRollTimingPositionPercent(positionPercent)}%, 0, 0)`
);

const hasFiniteHorizontalRect = (rect: HorizontalClientRect) => (
  Number.isFinite(rect.left) && Number.isFinite(rect.width)
);

export function getVisibleRollTimingPositionPercent(
  meterRect: HorizontalClientRect,
  orbRect: HorizontalClientRect,
) {
  if (!hasFiniteHorizontalRect(meterRect) || !hasFiniteHorizontalRect(orbRect) || meterRect.width <= 0 || orbRect.width < 0) {
    return undefined;
  }
  const orbCenterX = orbRect.left + orbRect.width / 2;
  return normalizeRollTimingPositionPercent(((orbCenterX - meterRect.left) / meterRect.width) * 100);
}

export function getVisibleRollTimingTrackOffsetPx(
  trackRect: HorizontalClientRect,
  trackLayoutLeftPx: number,
) {
  if (!hasFiniteHorizontalRect(trackRect) || !Number.isFinite(trackLayoutLeftPx)) return undefined;
  return trackRect.left - trackLayoutLeftPx;
}
