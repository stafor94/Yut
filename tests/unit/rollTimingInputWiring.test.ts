import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const boardControlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');

test('타이밍 판정은 마지막 렌더 스냅샷을 제출·정지 표시에 공통 사용하고 중복 입력을 차단한다', () => {
  assert.match(controlSource, /getVisibleRollTimingPositionPercent/);
  assert.match(controlSource, /getVisibleRollTimingTrackOffsetPx/);
  assert.match(controlSource, /meterRef/);
  assert.match(controlSource, /trackRef/);
  assert.match(controlSource, /orbRef/);
  assert.match(controlSource, /getBoundingClientRect\(\)/);
  assert.match(controlSource, /const offsetParent = track\.offsetParent;[\s\S]*offsetParent\.clientLeft \+ track\.offsetLeft/);
  assert.match(controlSource, /const tick = \(capturedAt: number\) => \{[\s\S]*sampleRenderedFrame\(capturedAt\);[\s\S]*requestAnimationFrame\(tick\)/);
  assert.match(controlSource, /const captureLastRenderedSnapshot = \(\) => lastRenderedSnapshotRef\.current \?\? sampleRenderedFrame\(performance\.now\(\)\)/);
  assert.match(controlSource, /if \(submittedKeyRef\.current === resetKey\) return 'duplicate';[\s\S]*const snapshot = captureLastRenderedSnapshot\(\);[\s\S]*submittedKeyRef\.current = resetKey;[\s\S]*freezeTimingTrack\(snapshot\);[\s\S]*holdTimingResult\(snapshot\);[\s\S]*onRoll\(snapshot\.positionPercent,/);
  assert.match(controlSource, /track\.style\.transform = `translate3d\(\$\{snapshot\.trackOffsetPx\}px, 0, 0\)`;[\s\S]*animation\?\.cancel\(\)/);
  assert.match(controlSource, /heldTrack\.style\.transform = `translate3d\(\$\{snapshot\.trackOffsetPx\}px, 0, 0\)`/);
  assert.match(controlSource, /heldMeter\.dataset\.positionPercent = String\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /parent\.insertBefore\(heldMeter, button\)/);
  assert.match(controlSource, /const submissionResult = submitCurrentTiming\(true\);[\s\S]*submissionResult === 'unavailable'/);
  assert.match(controlSource, /onPointerDown=\{handlePointerDown\}/);
  assert.match(controlSource, /onPointerUp=\{handlePointerUp\}/);
  assert.match(controlSource, /onPointerCancel=\{handlePointerCancel\}/);
  assert.match(controlSource, /setPointerCapture/);
  assert.match(controlSource, /releasedPointerTimingRef/);
  assert.match(controlSource, /event\.detail > 0/);
  assert.match(controlSource, /event\.clientX/);
  assert.match(controlSource, /event\.clientY/);
  assert.doesNotMatch(controlSource, /getAnimationPositionPercent/);
});

test('시간초과 roll은 deadline의 실제 화면 위치를 멈춘 뒤 네트워크 유예 후 제출한다', () => {
  assert.match(boardControlsSource, /autoSubmitAt=\{authoritativeTurnDeadline\.at\}/);
  assert.match(boardControlsSource, /markTurnActionTimedOut\(\);[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*onRollYutRef\.current\(\{ timedOut: true, timingPositionPercent \}\)/);
  assert.match(boardControlsSource, /\}, TURN_NETWORK_GRACE_MS\)/);
});
