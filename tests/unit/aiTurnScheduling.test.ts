import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AI_TURN_READY_BOUNDARY_BUFFER_MS,
  getAiTurnScheduleDelayFromDiagnosticState,
  getAiTurnScheduleDelayMs,
  getAiTurnTimeoutCandidates,
  resolveAiTurnActionReadyAt,
} from '../../src/app/flows/aiTurnScheduling.js';
import {
  DEFAULT_TURN_DELAY_MS,
  TURN_DELAY_MS,
  setScheduledAiTurnDelayMs,
} from '../../src/app/config/gameTimings.js';

const now = 10_000;

test('미래 authoritative readyAt은 남은 시간과 경계 버퍼만 기다린다', () => {
  assert.equal(resolveAiTurnActionReadyAt({
    deadlineAt: now + 15_500,
    deadlineKind: 'roll',
    hintedDurationMs: 15_000,
    now,
  }), now + 500);
  assert.equal(getAiTurnScheduleDelayMs({
    deadlineAt: now + 15_500,
    deadlineKind: 'roll',
    hintedDurationMs: 15_000,
    fallbackDelayMs: DEFAULT_TURN_DELAY_MS,
    now,
  }), 500 + AI_TURN_READY_BOUNDARY_BUFFER_MS);
});

test('이미 지난 authoritative readyAt은 기본 1초 없이 경계 버퍼만 기다린다', () => {
  assert.equal(resolveAiTurnActionReadyAt({
    deadlineAt: now + 14_500,
    deadlineKind: 'move',
    hintedDurationMs: 15_000,
    now,
  }), now - 500);
  assert.equal(getAiTurnScheduleDelayMs({
    deadlineAt: now + 14_500,
    deadlineKind: 'move',
    hintedDurationMs: 15_000,
    fallbackDelayMs: DEFAULT_TURN_DELAY_MS,
    now,
  }), AI_TURN_READY_BOUNDARY_BUFFER_MS);
});

test('authoritative deadline이 없으면 기존 기본 AI delay로 fallback한다', () => {
  assert.equal(getAiTurnScheduleDelayMs({
    deadlineAt: 0,
    deadlineKind: 'roll',
    hintedDurationMs: 15_000,
    fallbackDelayMs: DEFAULT_TURN_DELAY_MS,
    now,
  }), DEFAULT_TURN_DELAY_MS);
});

test('이미 만료된 authoritative deadline은 timeout recovery와 경합하지 않도록 fallback한다', () => {
  assert.equal(getAiTurnScheduleDelayMs({
    deadlineAt: now - 1,
    deadlineKind: 'roll',
    hintedDurationMs: 5_000,
    fallbackDelayMs: DEFAULT_TURN_DELAY_MS,
    now,
  }), DEFAULT_TURN_DELAY_MS);
});

test('감소된 10초와 5초 제한시간에서도 readyAt을 deadline에서 역산한다', () => {
  assert.deepEqual(getAiTurnTimeoutCandidates('roll', 15_000), [15_000, 10_000, 5_000]);
  assert.equal(resolveAiTurnActionReadyAt({
    deadlineAt: now + 12_000,
    deadlineKind: 'roll',
    hintedDurationMs: 15_000,
    now,
  }), now + 2_000);
  assert.equal(resolveAiTurnActionReadyAt({
    deadlineAt: now + 7_000,
    deadlineKind: 'roll',
    hintedDurationMs: 15_000,
    now,
  }), now + 2_000);
});

test('아이템과 함정 단계도 실제 10초 또는 5초 제한시간을 사용한다', () => {
  assert.deepEqual(getAiTurnTimeoutCandidates('item_prompt', 10_000), [10_000, 5_000]);
  assert.equal(getAiTurnScheduleDelayMs({
    deadlineAt: now + 12_000,
    deadlineKind: 'item_prompt',
    hintedDurationMs: 10_000,
    fallbackDelayMs: DEFAULT_TURN_DELAY_MS,
    now,
  }), 2_000 + AI_TURN_READY_BOUNDARY_BUFFER_MS);
  assert.equal(getAiTurnScheduleDelayMs({
    deadlineAt: now + 7_000,
    deadlineKind: 'trap_placement',
    hintedDurationMs: 10_000,
    fallbackDelayMs: DEFAULT_TURN_DELAY_MS,
    now,
  }), 2_000 + AI_TURN_READY_BOUNDARY_BUFFER_MS);
});

test('게임 밖과 사람 턴은 기존 지연으로 돌아간다', () => {
  assert.equal(getAiTurnScheduleDelayFromDiagnosticState({
    screen: 'lobby',
    activeSeat: { isAI: true },
    turnDeadlineAt: now + 17_000,
    turnDeadlineKind: 'roll',
  }, DEFAULT_TURN_DELAY_MS, now), DEFAULT_TURN_DELAY_MS);
  assert.equal(getAiTurnScheduleDelayFromDiagnosticState({
    screen: 'game',
    activeSeat: { isAI: false },
    turnDeadlineAt: now + 17_000,
    turnDeadlineKind: 'roll',
  }, DEFAULT_TURN_DELAY_MS, now), DEFAULT_TURN_DELAY_MS);
});

test('AI 예약 지연 live binding은 유효한 값만 반영하고 잘못된 값은 초기화한다', () => {
  setScheduledAiTurnDelayMs(2_080.2);
  assert.equal(TURN_DELAY_MS, 2_081);
  setScheduledAiTurnDelayMs(Number.NaN);
  assert.equal(TURN_DELAY_MS, DEFAULT_TURN_DELAY_MS);
});

test('계산된 지연은 실제 AI effect의 TURN_DELAY_MS 예약 경로에 연결된다', () => {
  const appSource = readFileSync('src/app/App.tsx', 'utf8');
  const syncHookSource = readFileSync('src/app/hooks/useGameSync.ts', 'utf8');
  assert.match(appSource, /window\.setTimeout\(\(\) => \{[\s\S]*?autoPlayTurn\(activeSeat, actionKey\);[\s\S]*?\}, TURN_DELAY_MS\);/);
  assert.match(syncHookSource, /setScheduledAiTurnDelayMs\(getAiTurnScheduleDelayFromDiagnosticState\(diagnosticState, DEFAULT_TURN_DELAY_MS\)\)/);
});
