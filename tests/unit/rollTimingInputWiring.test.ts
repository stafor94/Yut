import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const motionSource = readFileSync('src/game-core/rollTimingMotion.ts', 'utf8');
const timingCssSource = readFileSync('src/styles/roll-timing-ios-smoothness.css', 'utf8');
const boardControlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const appSource = readFileSync('src/app/App.tsx', 'utf8');
const timeoutResolverSource = readFileSync('src/features/room/services/timeoutResolvers.ts', 'utf8');

test('타이밍 오브는 deadline opportunity와 leaf rAF canonical percent를 공유하고 pointerdown snapshot으로 정지한다', () => {
  assert.match(controlSource, /getRollTimingMotionState/);
  assert.match(controlSource, /rollTimingOpportunitySnapshotCache/);
  assert.match(controlSource, /getRollTimingOrbLeft/);
  assert.match(controlSource, /frameRequestRef/);
  assert.match(controlSource, /lastRenderedSnapshotRef/);
  assert.match(controlSource, /window\.requestAnimationFrame\(tick\)/);
  assert.match(controlSource, /frameAnchorElapsedMsRef\.current[\s\S]*capturedAt - frameAnchorCapturedAtRef\.current[\s\S]*pausedDurationMsRef\.current/);
  assert.doesNotMatch(controlSource, /performanceEpochOffsetRef/);
  assert.match(controlSource, /track\.style\.transform = 'none';[\s\S]*orb\.style\.left = getRollTimingOrbLeft\(snapshot\.positionPercent\)/);
  assert.match(controlSource, /const snapshot = lastRenderedSnapshotRef\.current;[\s\S]*cancelFrameLoop\(\);[\s\S]*capturedPointerTimingRef\.current = \{ pointerId: event\.pointerId, resetKey, snapshot \}/);
  assert.match(controlSource, /if \(releasedInsideButton\) submitSnapshot\(deadlineExpired \? makeDeadlineSnapshot\(\) : capturedTiming\.snapshot, deadlineExpired\)/);
  assert.match(controlSource, /pendingTimeoutSnapshotRef\.current = makeDeadlineSnapshot\(\) \?\? capturedTiming\.snapshot/);
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
  assert.match(motionSource, /seedsByTimingWindow\.get\(timingWindowKey\)/);
  assert.match(controlSource, /data-initial-position-percent|dataset\.initialPositionPercent/);
  assert.match(controlSource, /timingStartedAt/);
  assert.match(boardControlsSource, /timingStartedAt=\{rollTimingStartedAt\}/);
  assert.match(boardControlsSource, /resetKey=\{rollTimingResetKey\}/);
  assert.doesNotMatch(controlSource, /Math\.random\(\)/);
});

test('시간초과 roll은 canonical deadline 위치를 즉시 한 번 제출하고 동일 seed를 사용한다', () => {
  assert.match(boardControlsSource, /autoSubmitAt=\{authoritativeTurnDeadline\.at\}/);
  assert.match(controlSource, /const deadlineElapsedMs = Math\.max\([\s\S]*autoSubmitAt - opportunity\.startedAt[\s\S]*return makeTimingSnapshot\(performance\.now\(\), deadlineElapsedMs\)/);
  assert.doesNotMatch(controlSource, /autoSubmitAt - opportunity\.startedAt - pausedDurationMsRef\.current/);
  assert.match(controlSource, /const getTimeoutSubmissionSnapshot = \(\) => makeDeadlineSnapshot\(\)/);
  assert.match(controlSource, /submitSnapshot\(getTimeoutSubmissionSnapshot\(\), true\)/);
  assert.match(controlSource, /handlePointerCancel[\s\S]*pendingTimeoutSnapshotRef\.current = makeDeadlineSnapshot\(\) \?\? capturedTiming\.snapshot/);
  assert.doesNotMatch(controlSource, /handlePointerCancel[\s\S]*submitSnapshot\(capturedTiming\.snapshot/);
  assert.match(boardControlsSource, /timedOutRollCommitKeyRef\.current === turnActionDeadlineKey/);
  assert.match(boardControlsSource, /timedOutRollCommitKeyRef\.current = turnActionDeadlineKey;[\s\S]*runWithRollTimeoutRandom\(authoritativeTurnDeadline\.at, \(\) => \{[\s\S]*onRollYutRef\.current\(\{ timedOut: true, timingPositionPercent \}\)/);
  assert.doesNotMatch(boardControlsSource, /TURN_NETWORK_GRACE_MS/);
  assert.match(boardControlsSource, /시간 초과 처리 중\.\.\./);
  assert.match(timeoutResolverSource, /rollTimingOpportunitySnapshotCache\.get\(\{/);
  assert.match(timeoutResolverSource, /startedAt: deadlineAt - normalizedWindowMs/);
  assert.match(timeoutResolverSource, /getRollTimingMotionState/);
  assert.match(timeoutResolverSource, /runWithRollTimeoutRandom/);
  assert.match(appSource, /rollOptions\.timedOut && turnDeadlineAt && rollOptions\.timingPositionPercent === undefined[\s\S]*resolveRollTimeout\(turnDeadlineAt, getTurnActionTimeoutMs\(activeSeat\.id\)\)/);
});
