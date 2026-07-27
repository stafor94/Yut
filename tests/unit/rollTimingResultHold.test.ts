import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getRollTimingResultHoldStyle,
  ROLL_TIMING_RESULT_HOLD_MS,
} from '../../src/app/flows/rollTimingResultHold.js';

const turnIndicatorCss = readFileSync('src/styles/turn-indicator.css', 'utf8');
const browserQaSource = readFileSync('tests/mobile/roll-timing-pointer-capture.spec.js', 'utf8');
const bugHistoryQaSource = readFileSync('tests/regression/bug-history-smoke.spec.js', 'utf8');

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

test('브라우저 QA가 실제 가시성·고정 좌표·1000ms 제거 시점을 관측한다', () => {
  assert.match(browserQaSource, /new MutationObserver/);
  assert.match(browserQaSource, /performance\.now\(\)/);
  assert.match(browserQaSource, /const sampleAt = \(elapsedMs\) => new Promise/);
  assert.match(browserQaSource, /Promise\.all\(\[0, 500, 900\]\.map\(sampleAt\)\)/);
  assert.doesNotMatch(browserQaSource, /waitUntilElapsed\(holdStartedAt, (?:500|900)\)/);
  assert.match(browserQaSource, /rollStageVisibleWhileHeld/);
  assert.match(browserQaSource, /phaseDeltaMs >= 48 && phaseDeltaMs < 500/);
  assert.match(browserQaSource, /__YUT_QA_TIMING_RESUME_OBSERVATION__/);
  assert.match(browserQaSource, /requestAnimationFrame\(observeResumedFrame\)/);
  assert.match(browserQaSource, /if \(releaseMode === 'inside'\) return gesture/);
  assert.match(browserQaSource, /releaseMode: 'outside'/);
  assert.match(browserQaSource, /releaseMode: 'cancel'/);
  assert.match(browserQaSource, /같은 방에서 Good pointerdown 후 pointercancel/);
  assert.match(browserQaSource, /removalDelayMs/);
  assert.match(browserQaSource, /toBeGreaterThanOrEqual\(1000\)/);
  assert.match(browserQaSource, /rollStageVisible/);
  assert.match(browserQaSource, /overlapsButton/);
});

test('sequence QA는 selected CSS 상태가 아니라 debug owner 계약으로 본인 이동을 관찰한다', () => {
  assert.match(bugHistoryQaSource, /const localSeatId = String\(debug\.localSeatId \?\? ''\)/);
  assert.match(bugHistoryQaSource, /debugPiece\?\.ownerId === localSeatId/);
  assert.match(bugHistoryQaSource, /localPieceTestIds\.has/);
  assert.doesNotMatch(bugHistoryQaSource, /\[data-testid\^="piece-"\]\.selected/);
});
