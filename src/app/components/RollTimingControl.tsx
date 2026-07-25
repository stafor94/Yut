import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getRollTimingPositionPercent } from '../../game-core/roll';
import {
  getVisibleRollTimingPositionPercent,
  getVisibleRollTimingTrackOffsetPx,
} from '../flows/rollTimingVisiblePosition';

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

type ReleasedPointerTiming = {
  releasedAt: number;
};

type VisibleTimingSnapshot = {
  positionPercent: number;
  trackOffsetPx?: number;
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
  const meterRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const orbRef = useRef<HTMLSpanElement | null>(null);
  const capturedPointerTimingRef = useRef<CapturedPointerTiming | null>(null);
  const releasedPointerTimingRef = useRef<ReleasedPointerTiming | null>(null);

  const getTimingAnimation = () => trackRef.current?.getAnimations()[0];

  const getVisibleTimingSnapshot = (): VisibleTimingSnapshot | undefined => {
    const meter = meterRef.current;
    const track = trackRef.current;
    const orb = orbRef.current;
    if (!meter || !orb) return undefined;

    const meterRect = meter.getBoundingClientRect();
    const orbRect = orb.getBoundingClientRect();
    const positionPercent = getVisibleRollTimingPositionPercent(meterRect, orbRect);
    if (positionPercent === undefined) return undefined;

    const trackOffsetPx = track
      ? getVisibleRollTimingTrackOffsetPx(meterRect, track.getBoundingClientRect())
      : undefined;
    return { positionPercent, trackOffsetPx };
  };

  const freezeTimingTrack = (animation: Animation | undefined, trackOffsetPx?: number) => {
    const track = trackRef.current;
    if (!track || typeof trackOffsetPx !== 'number' || !Number.isFinite(trackOffsetPx)) {
      animation?.pause();
      return;
    }

    track.style.transform = `translate3d(${trackOffsetPx}px, 0, 0)`;
    try {
      animation?.cancel();
    } catch {
      animation?.pause();
    }
  };

  const submitCurrentTiming = () => {
    const animation = getTimingAnimation();
    const visibleSnapshot = getVisibleTimingSnapshot();
    const positionPercent = visibleSnapshot?.positionPercent ?? getAnimationPositionPercent(animation);
    if (positionPercent === undefined) return false;
    freezeTimingTrack(animation, visibleSnapshot?.trackOffsetPx);
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
    releasedPointerTimingRef.current = null;
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
    releasedPointerTimingRef.current = { releasedAt: performance.now() };
    const targetRect = event.currentTarget.getBoundingClientRect();
    const releasedInsideButton = event.clientX >= targetRect.left && event.clientX <= targetRect.right
      && event.clientY >= targetRect.top && event.clientY <= targetRect.bottom;
    if (releasedInsideButton) submitCurrentTiming();
    releasePointerCapture(event);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (capturedPointerTimingRef.current?.pointerId === event.pointerId) {
      capturedPointerTimingRef.current = null;
      releasedPointerTimingRef.current = null;
      releasePointerCapture(event);
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const releasedTiming = releasedPointerTimingRef.current;
    const isFollowUpPointerClick = event.detail > 0
      && typeof releasedTiming?.releasedAt === 'number'
      && performance.now() - releasedTiming.releasedAt <= POINTER_RELEASE_CLICK_MAX_DELAY_MS;
    releasedPointerTimingRef.current = null;
    capturedPointerTimingRef.current = null;
    if (isFollowUpPointerClick) return;
    if (!submitCurrentTiming()) onRoll();
  };

  return <>
    <div key={`meter:${resetKey}`} ref={meterRef} className="roll-timing-meter" aria-label="윷 던지기 정확도 막대">
      <span className="roll-timing-good left" aria-hidden="true"></span>
      <span className="roll-timing-perfect" aria-hidden="true"></span>
      <span className="roll-timing-good right" aria-hidden="true"></span>
      <span ref={trackRef} className="roll-timing-orb-track" aria-hidden="true">
        <span ref={orbRef} className="roll-timing-orb"></span>
      </span>
    </div>
    <button type="button" data-testid={buttonTestId} className="roll-button" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onClick={handleClick} disabled={disabled}>{buttonText}</button>
  </>;
}
