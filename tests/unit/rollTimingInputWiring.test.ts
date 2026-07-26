import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const boardControlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const appSource = readFileSync('src/app/App.tsx', 'utf8');

test('타이밍 판정은 입력 이벤트에서 합성 transform을 동결한 단일 snapshot으로 정지 표시와 제출을 수행한다', () => {
  assert.match(controlSource, /getVisibleRollTimingPositionPercent/);
  assert.match(controlSource, /getVisibleRollTimingTrackOffsetPx/);
  assert.match(controlSource, /const computedTransform = window\.getComputedStyle\(track\)\.transform/);
  assert.match(controlSource, /track\.style\.transform = frozenTransform;[\s\S]*animation\.cancel\(\)[\s\S]*track\.style\.animation = 'none'/);
  assert.match(controlSource, /const meterRect = meter\.getBoundingClientRect\(\);[\s\S]*const trackRect = track\.getBoundingClientRect\(\);[\s\S]*const orbRect = orb\.getBoundingClientRect\(\)/);
  assert.match(controlSource, /const offsetParent = track\.offsetParent;[\s\S]*offsetParent\.clientLeft \+ track\.offsetLeft/);
  assert.match(controlSource, /return Object\.freeze\(\{[\s\S]*positionPercent,[\s\S]*trackOffsetPx,[\s\S]*frozenTransform,[\s\S]*capturedAt: performance\.now\(\),[\s\S]*resetKey/);
  assert.match(controlSource, /if \(submittedKeyRef\.current === resetKey\) return 'duplicate';[\s\S]*const snapshot = freezeAndCaptureTimingSnapshot\(\);[\s\S]*submittedKeyRef\.current = resetKey;[\s\S]*holdTimingResult\(snapshot\);[\s\S]*onRoll\(snapshot\.positionPercent,/);
  assert.match(controlSource, /heldMeter\.classList\.remove\('roll-timing-live-meter'\);[\s\S]*heldMeter\.classList\.add\('roll-timing-result-hold'\)/);
  assert.match(controlSource, /heldTrack\.style\.transform = snapshot\.frozenTransform/);
  assert.match(controlSource, /heldMeter\.dataset\.positionPercent = String\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /parent\.insertBefore\(heldMeter, button\);[\s\S]*heldMeter\.dataset\.holdStartedAt = String\(performance\.now\(\)\);[\s\S]*setTimeout\(clearResultHold, ROLL_TIMING_RESULT_HOLD_MS\)/);
  assert.match(controlSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(controlSource, /onPointerUp=\{handlePointerUp\}/);
  assert.match(controlSource, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(controlSource, /setPointerCapture/);
  assert.match(controlSource, /releasedPointerTimingRef/);
  assert.match(controlSource, /event\.detail > 0/);
  assert.match(controlSource, /event\.clientX/);
  assert.match(controlSource, /event\.clientY/);
  assert.doesNotMatch(controlSource, /lastRenderedSnapshotRef/);
  assert.doesNotMatch(controlSource, /requestAnimationFrame/);
  assert.doesNotMatch(controlSource, /getAnimationPositionPercent/);
  assert.doesNotMatch(controlSource, /animation\.currentTime/);
});

test('시간초과 roll은 활성 클라이언트의 동일 동결 snapshot만 제출하고 측정 실패 시 deadline 위치를 재계산하지 않는다', () => {
  assert.match(boardControlsSource, /autoSubmitAt=\{authoritativeTurnDeadline\.at\}/);
  assert.match(controlSource, /autoSubmittedKeyRef\.current = autoSubmitKey;[\s\S]*submitCurrentTiming\(true\)/);
  assert.doesNotMatch(controlSource, /onRoll\(undefined, \{ timedOut: true \}\)/);
  assert.match(boardControlsSource, /markTurnActionTimedOut\(\);[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*onRollYutRef\.current\(\{ timedOut: true, timingPositionPercent \}\)/);
  assert.match(boardControlsSource, /\}, TURN_NETWORK_GRACE_MS\)/);
  assert.match(appSource, /rollOptions\.timedOut && turnDeadlineAt && rollOptions\.timingPositionPercent === undefined[\s\S]*resolveRollTimeout\(turnDeadlineAt, getTurnActionTimeoutMs\(activeSeat\.id\)\)/);
});
