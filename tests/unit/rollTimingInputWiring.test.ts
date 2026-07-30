import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const motionSource = readFileSync('src/game-core/rollTimingMotion.ts', 'utf8');
const timingCssSource = readFileSync('src/styles/roll-timing-ios-smoothness.css', 'utf8');
const boardControlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const appSource = readFileSync('src/app/App.tsx', 'utf8');
const timeoutResolverSource = readFileSync('src/features/room/services/timeoutResolvers.ts', 'utf8');

test('타이밍 오브는 deadline opportunity와 leaf rAF canonical percent를 공유하고 pointerdown snapshot으로 정지·제출한다', () => {
  assert.match(controlSource, /getRollTimingMotionState/);
  assert.match(controlSource, /rollTimingOpportunitySnapshotCache/);
  assert.match(controlSource, /getRollTimingOrbLeft/);
  assert.match(controlSource, /frameRequestRef/);
  assert.match(controlSource, /lastRenderedSnapshotRef/);
  assert.match(controlSource, /window\.requestAnimationFrame\(tick\)/);
  assert.match(controlSource, /elapsedMs: Math\.max\(0, timingAt - opportunity\.startedAt - pausedDurationMsRef\.current\)/);
  assert.match(controlSource, /track\.style\.transform = 'none';[\s\S]*orb\.style\.left = getRollTimingOrbLeft\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /const snapshot = lastRenderedSnapshotRef\.current;[\s\S]*cancelFrameLoop\(\);[\s\S]*capturedPointerTimingRef\.current = \{ pointerId: event\.pointerId, resetKey, snapshot \}/);
  assert.match(controlSource, /if \(releasedInsideButton\) submitSnapshot\(capturedTiming\.snapshot, deadlineExpired\);[\s\S]*pendingTimeoutSnapshotRef\.current = capturedTiming\.snapshot;[\s\S]*resumeFrameLoop\(capturedTiming\.snapshot\)/);
  assert.match(controlSource, /heldTrack\.style\.transform = 'none';[\s\S]*heldOrb\.style\.left = getRollTimingOrbLeft\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /onRoll\(snapshot\.positionPercent,/);
  assert.match(controlSource, /if \(submittedKeyRef\.current === resetKey\) return 'duplicate'/);
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

test('초기 위치는 0~30% sampler 계약과 deadline seed를 사용하고 같은 opportunity에서 다시 추첨하지 않는다', () => {
  assert.match(motionSource, /ROLL_TIMING_INITIAL_MAX_PERCENT = 30/);
  assert.match(motionSource, /sampleRollTimingInitialPositionPercent/);
  assert.match(motionSource, /getRollTimingInitialPositionPercentForDeadline/);
  assert.match(motionSource, /const cached = snapshots\.get\(cacheKey\);[\s\S]*if \(cached\) return cached/);
  assert.match(controlSource, /data-initial-position-percent|dataset\.initialPositionPercent/);
  assert.match(controlSource, /timingStartedAt/);
  assert.match(boardControlsSource, /timingStartedAt=\{rollTimingStartedAt\}/);
  assert.match(boardControlsSource, /resetKey=\{rollTimingResetKey\}/);
  assert.doesNotMatch(controlSource, /Math\.random\(\)/);
});

test('시간초과 roll은 화면과 같은 opportunity를 authoritative deadline에서 계산하고 network grace 뒤 한 번만 제출한다', () => {
  assert.match(boardControlsSource, /autoSubmitAt=\{authoritativeTurnDeadline\.at\}/);
  assert.match(controlSource, /const makeDeadlineSnapshot = \(\) => makeTimingSnapshot\(performance\.now\(\), autoSubmitAt\)/);
  assert.match(controlSource, /submitSnapshot\(getTimeoutSubmissionSnapshot\(\), true\)/);
  assert.match(controlSource, /capturedPointerTimingRef\.current\?\.resetKey === resetKey[\s\S]*pendingTimeoutSnapshotRef\.current[\s\S]*makeDeadlineSnapshot\(\)/);
  assert.match(controlSource, /handlePointerCancel[\s\S]*pendingTimeoutSnapshotRef\.current = capturedTiming\.snapshot;[\s\S]*resumeFrameLoop\(capturedTiming\.snapshot\)/);
  assert.doesNotMatch(controlSource, /handlePointerCancel[\s\S]*submitSnapshot\(capturedTiming\.snapshot/);
  assert.match(boardControlsSource, /timedOutRollCommitKeyRef\.current === turnActionDeadlineKey/);
  assert.match(boardControlsSource, /timedOutRollCommitKeyRef\.current = turnActionDeadlineKey;[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*onRollYutRef\.current\(\{ timedOut: true, timingPositionPercent \}\)/);
  assert.match(boardControlsSource, /\}, TURN_NETWORK_GRACE_MS\)/);
  assert.match(boardControlsSource, /시간 초과 처리 중\.\.\./);
  assert.match(timeoutResolverSource, /getRollTimingInitialPositionPercentForDeadline\(deadlineAt\)/);
  assert.match(timeoutResolverSource, /getRollTimingMotionState/);
  assert.match(appSource, /rollOptions\.timedOut && turnDeadlineAt && rollOptions\.timingPositionPercent === undefined[\s\S]*resolveRollTimeout\(turnDeadlineAt, getTurnActionTimeoutMs\(activeSeat\.id\)\)/);
});
