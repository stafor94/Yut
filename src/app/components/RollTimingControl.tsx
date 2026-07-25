import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
  resetKey: string;
};

type SubmittedPointerTiming = {
  releasedAt: number;
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
  const submittedPointerTimingRef = useRef<SubmittedPointerTiming | null>(null);

  const getTimingAnimation = () => trackRef.current?.getAnimations()[0];
  const getCurrentTimingPositionPercent = () => getAnimationPositionPercent(getTimingAnimation());

  const submitCurrentTiming = () => {
    const animation = getTimingAnimation();
    const positionPercent = getAnimationPositionPercent(animation);
    if (positionPercent === undefined) return false;
    animation?.pause();
    onRoll(positionPercent);
    return true;
  };

  const releasePointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Some mobile browsers can drop capture before React receives the terminal event.
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    capturedPointerTimingRef.current = { pointerId: event.pointerId, resetKey };
    submittedPointerTimingRef.current = null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Touch browsers with implicit capture can reject an explicit capture request.
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const capturedTiming = capturedPointerTimingRef.current;
    if (capturedTiming?.pointerId !== event.pointerId || capturedTiming.resetKey !== resetKey) return;
    capturedPointerTimingRef.current = null;
    releasePointerCapture(event);
    submittedPointerTimingRef.current = submitCurrentTiming()
      ? { releasedAt: performance.now() }
      : null;
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (capturedPointerTimingRef.current?.pointerId === event.pointerId) {
      capturedPointerTimingRef.current = null;
      submittedPointerTimingRef.current = null;
      releasePointerCapture(event);
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const submittedTiming = submittedPointerTimingRef.current;
    const isFollowUpPointerClick = event.detail > 0
      && typeof submittedTiming?.releasedAt === 'number'
      && performance.now() - submittedTiming.releasedAt <= POINTER_RELEASE_CLICK_MAX_DELAY_MS;
    submittedPointerTimingRef.current = null;
    capturedPointerTimingRef.current = null;
    if (isFollowUpPointerClick) return;
    onRoll(getCurrentTimingPositionPercent());
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
