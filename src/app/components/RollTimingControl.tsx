import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  getVisibleRollTimingPositionPercent,
  getVisibleRollTimingTrackOffsetPx,
} from '../flows/rollTimingVisiblePosition';
import {
  getRollTimingResultHoldStyle,
  ROLL_TIMING_RESULT_HOLD_MS,
} from '../flows/rollTimingResultHold';

type RollTimingControlProps = {
  disabled?: boolean;
  buttonText: string;
  buttonTestId: string;
  resetKey?: string;
  autoSubmitAt?: number;
  onRoll: (timingPositionPercent?: number, options?: { timedOut?: boolean }) => void;
};

type CapturedPointerTiming = {
  pointerId: number;
  resetKey: string;
};

type ReleasedPointerTiming = {
  releasedAt: number;
};

type RollTimingSnapshot = Readonly<{
  positionPercent: number;
  trackOffsetPx: number;
  frozenTransform: string;
  capturedAt: number;
  resetKey: string;
}>;

type TimingSubmissionResult = 'submitted' | 'duplicate' | 'unavailable';

const POINTER_RELEASE_CLICK_MAX_DELAY_MS = 1000;
const IDENTITY_TRACK_TRANSFORM = 'matrix(1, 0, 0, 1, 0, 0)';

export function RollTimingControl({ disabled = false, buttonText, buttonTestId, resetKey = '', autoSubmitAt = 0, onRoll }: RollTimingControlProps) {
  const meterRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const orbRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const capturedPointerTimingRef = useRef<CapturedPointerTiming | null>(null);
  const releasedPointerTimingRef = useRef<ReleasedPointerTiming | null>(null);
  const resultHoldTimerRef = useRef<number | null>(null);
  const resultHoldElementRef = useRef<HTMLElement | null>(null);
  const autoSubmittedKeyRef = useRef('');
  const submittedKeyRef = useRef<string | null>(null);

  const clearResultHold = () => {
    if (resultHoldTimerRef.current !== null) {
      window.clearTimeout(resultHoldTimerRef.current);
      resultHoldTimerRef.current = null;
    }
    resultHoldElementRef.current?.remove();
    resultHoldElementRef.current = null;
  };

  const freezeAndCaptureTimingSnapshot = () => {
    const meter = meterRef.current;
    const track = trackRef.current;
    const orb = orbRef.current;
    if (!meter || !track || !orb) return undefined;

    const animations = track.getAnimations();
    const computedTransform = window.getComputedStyle(track).transform;
    const frozenTransform = computedTransform && computedTransform !== 'none'
      ? computedTransform
      : IDENTITY_TRACK_TRANSFORM;

    track.style.transform = frozenTransform;
    for (const animation of animations) {
      try {
        animation.cancel();
      } catch {
        try {
          animation.pause();
        } catch {
          // The frozen inline transform remains authoritative if WebKit drops the animation handle.
        }
      }
    }
    track.style.animation = 'none';

    const meterRect = meter.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const orbRect = orb.getBoundingClientRect();
    const offsetParent = track.offsetParent;
    if (!(offsetParent instanceof HTMLElement)) return undefined;
    const offsetParentRect = offsetParent.getBoundingClientRect();
    const trackLayoutLeftPx = offsetParentRect.left + offsetParent.clientLeft + track.offsetLeft;
    const positionPercent = getVisibleRollTimingPositionPercent(meterRect, orbRect);
    const trackOffsetPx = getVisibleRollTimingTrackOffsetPx(trackRect, trackLayoutLeftPx);
    if (positionPercent === undefined || typeof trackOffsetPx !== 'number' || !Number.isFinite(trackOffsetPx)) return undefined;

    return Object.freeze({
      positionPercent,
      trackOffsetPx,
      frozenTransform,
      capturedAt: performance.now(),
      resetKey,
    }) satisfies RollTimingSnapshot;
  };

  const holdTimingResult = (snapshot: RollTimingSnapshot) => {
    const meter = meterRef.current;
    const button = buttonRef.current;
    const parent = meter?.parentElement;
    if (!meter || !button || !parent) return;

    clearResultHold();
    const heldMeter = meter.cloneNode(true) as HTMLDivElement;
    const heldTrack = heldMeter.querySelector<HTMLElement>('.roll-timing-orb-track');
    heldMeter.classList.remove('roll-timing-live-meter');
    heldMeter.classList.add('roll-timing-result-hold');
    if (heldTrack) {
      heldTrack.style.animation = 'none';
      heldTrack.style.transform = snapshot.frozenTransform;
    }
    heldMeter.dataset.testid = 'roll-timing-result-hold';
    heldMeter.dataset.positionPercent = String(snapshot.positionPercent);
    heldMeter.dataset.trackOffsetPx = String(snapshot.trackOffsetPx);
    heldMeter.dataset.capturedAt = String(snapshot.capturedAt);
    heldMeter.dataset.holdStartedAt = String(performance.now());
    heldMeter.dataset.resetKey = snapshot.resetKey;
    heldMeter.setAttribute('aria-label', '멈춘 윷 던지기 정확도 위치');
    Object.assign(heldMeter.style, getRollTimingResultHoldStyle());
    parent.insertBefore(heldMeter, button);
    resultHoldElementRef.current = heldMeter;
    resultHoldTimerRef.current = window.setTimeout(clearResultHold, ROLL_TIMING_RESULT_HOLD_MS);
  };

  const submitCurrentTiming = (timedOut = false): TimingSubmissionResult => {
    if (submittedKeyRef.current === resetKey) return 'duplicate';
    const snapshot = freezeAndCaptureTimingSnapshot();
    if (!snapshot) return 'unavailable';
    submittedKeyRef.current = resetKey;
    holdTimingResult(snapshot);
    onRoll(snapshot.positionPercent, timedOut ? { timedOut: true } : undefined);
    return 'submitted';
  };

  useEffect(() => {
    submittedKeyRef.current = null;
    autoSubmittedKeyRef.current = '';
    capturedPointerTimingRef.current = null;
    releasedPointerTimingRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (disabled || !autoSubmitAt || typeof window === 'undefined') return undefined;
    const autoSubmitKey = `${resetKey}:${autoSubmitAt}`;
    const submitTimedOutRoll = () => {
      if (autoSubmittedKeyRef.current === autoSubmitKey) return;
      autoSubmittedKeyRef.current = autoSubmitKey;
      const submissionResult = submitCurrentTiming(true);
      if (submissionResult === 'unavailable') onRoll(undefined, { timedOut: true });
    };
    const remainingMs = autoSubmitAt - Date.now();
    if (remainingMs <= 0) {
      submitTimedOutRoll();
      return undefined;
    }
    const timer = window.setTimeout(submitTimedOutRoll, remainingMs);
    return () => window.clearTimeout(timer);
  }, [autoSubmitAt, disabled, onRoll, resetKey]);

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
    submitCurrentTiming();
  };

  return <>
    <div key={`meter:${resetKey}`} ref={meterRef} className="roll-timing-meter roll-timing-live-meter" aria-label="윷 던지기 정확도 막대">
      <span className="roll-timing-good left" aria-hidden="true"></span>
      <span className="roll-timing-perfect" aria-hidden="true"></span>
      <span className="roll-timing-good right" aria-hidden="true"></span>
      <span ref={trackRef} className="roll-timing-orb-track" aria-hidden="true">
        <span ref={orbRef} className="roll-timing-orb"></span>
      </span>
    </div>
    <button ref={buttonRef} type="button" data-testid={buttonTestId} className="roll-button" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onClick={handleClick} disabled={disabled}>{buttonText}</button>
  </>;
}
