import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const timingCssSource = readFileSync('src/styles/roll-timing-ios-smoothness.css', 'utf8');
const boardControlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const appSource = readFileSync('src/app/App.tsx', 'utf8');

test('타이밍 오브는 leaf rAF 하나가 canonical percent를 기록하고 pointerdown snapshot으로 정지·제출한다', () => {
  assert.match(controlSource, /getRollTimingPositionPercent/);
  assert.match(controlSource, /getRollTimingTrackTransform/);
  assert.match(controlSource, /frameRequestRef/);
  assert.match(controlSource, /lastRenderedSnapshotRef/);
  assert.match(controlSource, /window\.requestAnimationFrame\(tick\)/);
  assert.match(controlSource, /positionPercent: normalizeRollTimingPositionPercent\(getRollTimingPositionPercent\(phaseMs\)\)/);
  assert.match(controlSource, /track\.style\.transform = getRollTimingTrackTransform\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /const snapshot = lastRenderedSnapshotRef\.current;[\s\S]*cancelFrameLoop\(\);[\s\S]*capturedPointerTimingRef\.current = \{ pointerId: event\.pointerId, resetKey, snapshot \}/);
  assert.match(controlSource, /if \(releasedInsideButton\) submitSnapshot\(capturedTiming\.snapshot, deadlineExpired\);[\s\S]*pendingTimeoutSnapshotRef\.current = capturedTiming\.snapshot;[\s\S]*resumeFrameLoop\(capturedTiming\.snapshot\)/);
  assert.match(controlSource, /heldTrack\.style\.transform = getRollTimingTrackTransform\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /onRoll\(snapshot\.positionPercent,/);
  assert.match(controlSource, /capturedPointerTimingRef\.current\?\.resetKey === resetKey[\s\S]*capturedPointerTimingRef\.current\.snapshot[\s\S]*pendingTimeoutSnapshotRef\.current[\s\S]*lastRenderedSnapshotRef\.current/);
  assert.match(controlSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(controlSource, /onPointerUp=\{handlePointerUp\}/);
  assert.match(controlSource, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(controlSource, /event\.detail > 0/);
  assert.doesNotMatch(controlSource, /getComputedStyle/);
  assert.doesNotMatch(controlSource, /getAnimations/);
  assert.doesNotMatch(controlSource, /frozenTransform/);
  assert.doesNotMatch(controlSource, /trackOffsetPx/);
  assert.match(timingCssSource, /animation:\s*none/);
  assert.doesNotMatch(timingCssSource, /@keyframes\s+roll-timing-orb-track/);
});

test('시간초과 roll은 활성 pointerdown snapshot 또는 마지막 실제 rAF snapshot만 사용하고 deadline 위치를 재계산하지 않는다', () => {
  assert.match(boardControlsSource, /autoSubmitAt=\{authoritativeTurnDeadline\.at\}/);
  assert.match(controlSource, /submitSnapshot\(getSubmissionSnapshot\(\), true\)/);
  assert.doesNotMatch(controlSource, /getRollTimingPositionPercent\(autoSubmitAt/);
  assert.doesNotMatch(controlSource, /Date\.now\(\)[\s\S]*getRollTimingPositionPercent/);
  assert.doesNotMatch(controlSource, /onRoll\(undefined, \{ timedOut: true \}\)/);
  assert.match(controlSource, /handlePointerCancel[\s\S]*pendingTimeoutSnapshotRef\.current = capturedTiming\.snapshot;[\s\S]*resumeFrameLoop\(capturedTiming\.snapshot\)/);
  assert.doesNotMatch(controlSource, /handlePointerCancel[\s\S]*submitSnapshot\(capturedTiming\.snapshot/);
  assert.match(boardControlsSource, /markTurnActionTimedOut\(\);[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*onRollYutRef\.current\(\{ timedOut: true, timingPositionPercent \}\)/);
  assert.match(boardControlsSource, /\}, TURN_NETWORK_GRACE_MS\)/);
  assert.match(appSource, /rollOptions\.timedOut && turnDeadlineAt && rollOptions\.timingPositionPercent === undefined[\s\S]*resolveRollTimeout\(turnDeadlineAt, getTurnActionTimeoutMs\(activeSeat\.id\)\)/);
});
