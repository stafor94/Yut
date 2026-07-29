import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getRollTimingResultHoldStyle,
  ROLL_TIMING_RESULT_HOLD_MS,
} from '../../src/app/flows/rollTimingResultHold.js';

const turnIndicatorCss = readFileSync('src/styles/turn-indicator.css', 'utf8');
const browserQaSource = readFileSync('tests/mobile/roll-timing-pointer-capture.spec.js', 'utf8');
const timingControlSource = readFileSync('src/app/components/RollTimingControl.tsx', 'utf8');
const regressionQaSource = readFileSync('tests/regression/bug-history-smoke.spec.js', 'utf8');

test('멈춘 타이밍 위치를 정확히 1초간 유지한다', () => {
  assert.equal(ROLL_TIMING_RESULT_HOLD_MS, 1000);
});

test('정지 결과 막대를 원래 컨트롤 grid 흐름에 유지한다', () => {
  assert.deepEqual(getRollTimingResultHoldStyle(), {
    position: 'relative',
    margin: '0',
    pointerEvents: 'none',
    justifySelf: 'center',
  });
});

test('roll-stage 숨김 규칙은 live meter에만 적용하고 정지 결과 제품 클래스는 제외한다', () => {
  assert.match(turnIndicatorCss, /\.roll-stage ~ \.play-controls \.roll-timing-live-meter\s*\{[\s\S]*display:\s*none/);
  assert.doesNotMatch(turnIndicatorCss, /\.roll-stage ~ \.play-controls \.roll-timing-meter\s*\{/);
  assert.doesNotMatch(turnIndicatorCss, /\.roll-stage ~ \.play-controls \.roll-timing-result-hold\s*\{[\s\S]*display:\s*none/);
});

test('취소 뒤 첫 rAF timestamp가 resume 기준보다 이르더라도 phase를 뒤로 렌더링하지 않는다', () => {
  assert.match(timingControlSource, /const scheduleFrameLoop = \(minimumCapturedAt = 0\)/);
  assert.match(timingControlSource, /const frameCapturedAt = Math\.max\(capturedAt, nextMinimumCapturedAt\)/);
  assert.match(timingControlSource, /const resumedAt = performance\.now\(\)/);
  assert.match(timingControlSource, /scheduleFrameLoop\(resumedAt\)/);
});

test('브라우저 QA가 실제 가시성·고정 좌표·1000ms 제거 시점을 관측한다', () => {
  assert.match(browserQaSource, /new MutationObserver/);
  assert.match(browserQaSource, /performance\.now\(\)/);
  assert.match(browserQaSource, /const sampleAt = \(elapsedMs\) => new Promise/);
  assert.match(browserQaSource, /Promise\.all\(\[0, 500, 900\]\.map\(sampleAt\)\)/);
  assert.doesNotMatch(browserQaSource, /waitUntilElapsed\(holdStartedAt, (?:500|900)\)/);
  assert.match(browserQaSource, /rollStageVisibleWhileHeld/);
  assert.match(browserQaSource, /snapshot\.capturedAt > pointerDownSnapshot\.capturedAt/);
  assert.match(browserQaSource, /resumedElapsedMs = resumedSnapshot\.capturedAt - releasedAt/);
  assert.match(browserQaSource, /Math\.abs\(phaseDeltaMs - gesture\.resumedElapsedMs\)/);
  assert.doesNotMatch(browserQaSource, /phaseDeltaMs >= 48 && phaseDeltaMs < 500/);
  assert.match(browserQaSource, /releaseMode: 'outside'/);
  assert.match(browserQaSource, /releaseMode: 'cancel'/);
  assert.match(browserQaSource, /같은 방에서 Good pointerdown 후 pointercancel/);
  assert.match(browserQaSource, /removalDelayMs/);
  assert.match(browserQaSource, /toBeGreaterThanOrEqual\(1000\)/);
  assert.match(browserQaSource, /rollStageVisible/);
  assert.match(browserQaSource, /overlapsButton/);
});

test('Good 장기 press QA는 양방향 실제 렌더 구간에서 180ms 뒤 Perfect 통과 시간을 검증한다', () => {
  assert.match(browserQaSource, /const GOOD_PRESS_RANGES = Object\.freeze\(\[\[27, 37\], \[63, 73\]\]\)/);
  assert.doesNotMatch(browserQaSource, /const GOOD_PRESS_RANGE = Object\.freeze\(\[30, 34\]\)/);
  assert.match(browserQaSource, /pointerDownRanges: GOOD_PRESS_RANGES/);
  assert.match(browserQaSource, /requireAscending: null/);
  assert.match(browserQaSource, /const movementDirection = gesture\.pointerDownSnapshot\.phaseMs < ROLL_TIMING_CYCLE_MS \/ 2 \? 1 : -1/);
  assert.match(browserQaSource, /movementDirection \* \(LONG_PRESS_MS \/ 10\)/);
});

test('Desktop sequence QA는 실제 로컬 말 이동과 이동 불가 재시도를 구분한다', () => {
  assert.match(regressionQaSource, /let moveRequested = false/);
  assert.match(regressionQaSource, /debugPiece\?\.ownerId === localSeatId/);
  assert.match(regressionQaSource, /finish\('move-clicked'\)/);
  assert.match(regressionQaSource, /finish\('retry'\)/);
  assert.doesNotMatch(regressionQaSource, /resolve\('move-clicked'\);\s*return;/);
});
