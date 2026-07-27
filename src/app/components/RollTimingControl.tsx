import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getRollTimingPositionPercent } from '../../game-core/roll';
import {
  getRollTimingTrackTransform,
  normalizeRollTimingPositionPercent,
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

type RollTimingSnapshot = Readonly<{
  phaseMs: number;
  positionPercent: number;
  capturedAt: number;
  resetKey: string;
}>;

type CapturedPointerTiming = {
  pointerId: number;
  resetKey: string;
  snapshot: RollTimingSnapshot;
};

type ReleasedPointerTiming = {
  releasedAt: number;
};

type TimingSubmissionResult = 'submitted' | 'duplicate' | 'unavailable';

const POINTER_RELEASE_CLICK_MAX_DELAY_MS = 1000;
const ROLL_TIMING_CYCLE_MS = 2000;

const normalizePhaseMs = (elapsedMs: number) => (
  ((elapsedMs % ROLL_TIMING_CYCLE_MS) + ROLL_TIMING_CYCLE_MS) % ROLL_TIMING_CYCLE_MS
);

export function RollTimingControl({ disabled = false, buttonText, buttonTestId, resetKey = '', autoSubmitAt = 0, onRoll }: RollTimingControlProps) {
  const meterRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const frameStartedAtRef = useRef(0);
  const frameRequestRef = useRef<number | null>(null);
  const lastRenderedSnapshotRef = useRef<RollTimingSnapshot | null>(null);
  const capturedPointerTimingRef = useRef<CapturedPointerTiming | null>(null);
  const releasedPointerTimingRef = useRef<ReleasedPointerTiming | null>(null);
  const pendingTimeoutSnapshotRef = useRef<RollTimingSnapshot | null>(null);
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

  const cancelFrameLoop = () => {
    if (frameRequestRef.current === null) return;
    window.cancelAnimationFrame(frameRequestRef.current);
    frameRequestRef.current = null;
  };

  const applyRenderedSnapshot = (snapshot: RollTimingSnapshot) => {
    const meter = meterRef.current;
    const track = trackRef.current;
    if (!meter || !track || snapshot.resetKey !== resetKey) return false;
    track.style.transform = getRollTimingTrackTransform(snapshot.positionPercent);
    meter.dataset.positionPercent = String(snapshot.positionPercent);
    meter.dataset.phaseMs = String(snapshot.phaseMs);
    meter.dataset.capturedAt = String(snapshot.capturedAt);
    meter.dataset.resetKey = snapshot.resetKey;
    lastRenderedSnapshotRef.current = snapshot;
    return true;
  };

  const renderFrame = (capturedAt: number) => {
    const phaseMs = normalizePhaseMs(capturedAt - frameStartedAtRef.current);
    const snapshot = Object.freeze({
      phaseMs,
      positionPercent: normalizeRollTimingPositionPercent(getRollTimingPositionPercent(phaseMs)),
      capturedAt,
      resetKey,
    }) satisfies RollTimingSnapshot;
    return applyRenderedSnapshot(snapshot) ? snapshot : undefined;
  };

  const scheduleFrameLoop = () => {
    if (frameRequestRef.current !== null || submittedKeyRef.current === resetKey) return;
    const tick = (capturedAt: number) => {
      frameRequestRef.current = null;
      if (submittedKeyRef.current === resetKey || capturedPointerTimingRef.current) return;
      renderFrame(capturedAt);
      frameRequestRef.current = window.requestAnimationFrame(tick);
    };
    frameRequestRef.current = window.requestAnimationFrame(tick);
  };

  const resumeFrameLoop = (snapshot: RollTimingSnapshot) => {
    if (submittedKeyRef.current === resetKey || snapshot.resetKey !== resetKey) return;
    const resumedAt = performance.now();
    frameStartedAtRef.current = resumedAt - snapshot.phaseMs;
    renderFrame(resumedAt);
    scheduleFrameLoop();
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
      heldTrack.style.transform = getRollTimingTrackTransform(snapshot.positionPercent);
    }
    heldMeter.dataset.testid = 'roll-timing-result-hold';
    heldMeter.dataset.positionPercent = String(snapshot.positionPercent);
    heldMeter.dataset.phaseMs = String(snapshot.phaseMs);
    heldMeter.dataset.capturedAt = String(snapshot.capturedAt);
    heldMeter.dataset.resetKey = snapshot.resetKey;
    heldMeter.setAttribute('aria-label', '멈춘 윷 던지기 정확도 위치');
    Object.assign(heldMeter.style, getRollTimingResultHoldStyle());
    parent.insertBefore(heldMeter, button);
    heldMeter.dataset.holdStartedAt = String(performance.now());
    resultHoldElementRef.current = heldMeter;
    resultHoldTimerRef.current = window.setTimeout(clearResultHold, ROLL_TIMING_RESULT_HOLD_MS);
  };

  const submitSnapshot = (snapshot: RollTimingSnapshot | null, timedOut = false): TimingSubmissionResult => {
    if (submittedKeyRef.current === resetKey) return 'duplicate';
    if (!snapshot || snapshot.resetKey !== resetKey) return 'unavailable';
    submittedKeyRef.current = resetKey;
    pendingTimeoutSnapshotRef.current = null;
    cancelFrameLoop();
    applyRenderedSnapshot(snapshot);
    holdTimingResult(snapshot);
    onRoll(snapshot.positionPercent, timedOut ? { timedOut: true } : undefined);
    return 'submitted';
  };

  const getSubmissionSnapshot = () => (
    capturedPointerTimingRef.current?.resetKey === resetKey
      ? capturedPointerTimingRef.current.snapshot
      : pendingTimeoutSnapshotRef.current?.resetKey === resetKey
        ? pendingTimeoutSnapshotRef.current
        : lastRenderedSnapshotRef.current?.resetKey === resetKey
          ? lastRenderedSnapshotRef.current
          : null
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    submittedKeyRef.current = null;
    autoSubmittedKeyRef.current = '';
    capturedPointerTimingRef.current = null;
    releasedPointerTimingRef.current = null;
    pendingTimeoutSnapshotRef.current = null;
    cancelFrameLoop();
    const startedAt = performance.now();
    frameStartedAtRef.current = startedAt;
    renderFrame(startedAt);
    scheduleFrameLoop();
    return () => {
      cancelFrameLoop();
      capturedPointerTimingRef.current = null;
      releasedPointerTimingRef.current = null;
      pendingTimeoutSnapshotRef.current = null;
    };
  }, [resetKey]);

  useEffect(() => {
    if (disabled || !autoSubmitAt || typeof window === 'undefined') return undefined;
    const autoSubmitKey = `${resetKey}:${autoSubmitAt}`;
    const submitTimedOutRoll = () => {
      if (autoSubmittedKeyRef.current === autoSubmitKey) return;
      autoSubmittedKeyRef.current = autoSubmitKey;
      submitSnapshot(getSubmissionSnapshot(), true);
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
    if (disabled || !event.isPrimary || event.button !== 0 || submittedKeyRef.current === resetKey) return;
    const snapshot = lastRenderedSnapshotRef.current;
    if (!snapshot || snapshot.resetKey !== resetKey) return;
    cancelFrameLoop();
    applyRenderedSnapshot(snapshot);
    capturedPointerTimingRef.current = { pointerId: event.pointerId, resetKey, snapshot };
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
    const deadlineExpired = autoSubmitAt > 0 && Date.now() >= autoSubmitAt;
    if (releasedInsideButton) submitSnapshot(capturedTiming.snapshot, deadlineExpired);
    else {
      if (deadlineExpired) pendingTimeoutSnapshotRef.current = capturedTiming.snapshot;
      resumeFrameLoop(capturedTiming.snapshot);
    }
    releasePointerCapture(event);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const capturedTiming = capturedPointerTimingRef.current;
    if (capturedTiming?.pointerId !== event.pointerId || capturedTiming.resetKey !== resetKey) return;
    capturedPointerTimingRef.current = null;
    releasedPointerTimingRef.current = { releasedAt: performance.now() };
    const deadlineExpired = autoSubmitAt > 0 && Date.now() >= autoSubmitAt;
    if (deadlineExpired) pendingTimeoutSnapshotRef.current = capturedTiming.snapshot;
    resumeFrameLoop(capturedTiming.snapshot);
    releasePointerCapture(event);
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const releasedTiming = releasedPointerTimingRef.current;
    const isFollowUpPointerClick = event.detail > 0
      && typeof releasedTiming?.releasedAt === 'number'
      && performance.now() - releasedTiming.releasedAt <= POINTER_RELEASE_CLICK_MAX_DELAY_MS;
    releasedPointerTimingRef.current = null;
    if (isFollowUpPointerClick || capturedPointerTimingRef.current) return;
    const snapshot = lastRenderedSnapshotRef.current?.resetKey === resetKey
      ? lastRenderedSnapshotRef.current
      : null;
    cancelFrameLoop();
    submitSnapshot(snapshot, autoSubmitAt > 0 && Date.now() >= autoSubmitAt);
  };

  return <>
    <div key={`meter:${resetKey}`} ref={meterRef} className="roll-timing-meter roll-timing-live-meter" aria-label="윷 던지기 정확도 막대">
      <span className="roll-timing-good left" aria-hidden="true"></span>
      <span className="roll-timing-perfect" aria-hidden="true"></span>
      <span className="roll-timing-good right" aria-hidden="true"></span>
      <span ref={trackRef} className="roll-timing-orb-track" aria-hidden="true">
        <span className="roll-timing-orb"></span>
      </span>
    </div>
    <button ref={buttonRef} type="button" data-testid={buttonTestId} className="roll-button" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onClick={handleClick} disabled={disabled}>{buttonText}</button>
  </>;
}
