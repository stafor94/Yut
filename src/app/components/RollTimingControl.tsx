import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { getRollTimingPositionPercent } from '../../game-core/roll';

type RollTimingControlProps = {
  disabled?: boolean;
  buttonText: string;
  buttonTestId: string;
  resetKey?: string;
  onRoll: (timingPositionPercent?: number) => void;
};

type CapturedPointerTiming = {
  pointerId: number;
  positionPercent: number;
  releasedAt: number | null;
  resetKey: string;
};

const POINTER_RELEASE_CLICK_MAX_DELAY_MS = 1000;
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const getAnimationPositionPercent = (animation: Animation | undefined) => {
  const currentTime = animation?.currentTime;
  if (typeof currentTime === 'number' && Number.isFinite(currentTime)) {
    return getRollTimingPositionPercent(currentTime);
  }

  const progress = animation?.effect?.getComputedTiming().progress;
  return typeof progress === 'number' && Number.isFinite(progress)
    ? clampPercent(progress * 100)
    : undefined;
};

export function RollTimingControl({ disabled = false, buttonText, buttonTestId, resetKey = '', onRoll }: RollTimingControlProps) {
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const capturedPointerTimingRef = useRef<CapturedPointerTiming | null>(null);

  const getCurrentTimingPositionPercent = () => getAnimationPositionPercent(trackRef.current?.getAnimations()[0]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    const positionPercent = getCurrentTimingPositionPercent();
    capturedPointerTimingRef.current = positionPercent === undefined
      ? null
      : { pointerId: event.pointerId, positionPercent, releasedAt: null, resetKey };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const capturedTiming = capturedPointerTimingRef.current;
    if (capturedTiming?.pointerId === event.pointerId && capturedTiming.resetKey === resetKey) {
      capturedTiming.releasedAt = performance.now();
    }
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (capturedPointerTimingRef.current?.pointerId === event.pointerId) {
      capturedPointerTimingRef.current = null;
    }
  };

  const handleClick = () => {
    const capturedTiming = capturedPointerTimingRef.current;
    const capturedPosition = capturedTiming && capturedTiming.resetKey === resetKey
      && typeof capturedTiming.releasedAt === 'number'
      && performance.now() - capturedTiming.releasedAt <= POINTER_RELEASE_CLICK_MAX_DELAY_MS
      ? capturedTiming.positionPercent
      : undefined;
    capturedPointerTimingRef.current = null;
    onRoll(capturedPosition ?? getCurrentTimingPositionPercent());
  };

  return <>
    <div key={`meter:${resetKey}`} className="roll-timing-meter" aria-label="윷 던지기 정확도 막대">
      <span className="roll-timing-good left" aria-hidden="true"></span>
      <span className="roll-timing-perfect" aria-hidden="true"></span>
      <span className="roll-timing-good right" aria-hidden="true"></span>
      <span ref={trackRef} className="roll-timing-orb-track" aria-hidden="true">
        <span className="roll-timing-orb"></span>
      </span>
    </div>
    <button type="button" data-testid={buttonTestId} className="roll-button" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onClick={handleClick} disabled={disabled}>{buttonText}</button>
  </>;
}
