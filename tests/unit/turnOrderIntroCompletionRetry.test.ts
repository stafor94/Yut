import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controllerSource = readFileSync('src/app/controllers/useGameStartController.ts', 'utf8');

test('authoritative 순서 정하기 완료는 coordinator lease 복구를 기다리는 제한 polling을 유지한다', () => {
  assert.match(controllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_DELAYS_MS = \[250, 500, 1_000, 2_000\]/);
  assert.match(controllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_INTERVAL_MS = 2_000/);
  assert.match(controllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_WINDOW_MS = 30_000/);
  assert.match(controllerSource, /const retryUntil = Math\.max\(Date\.now\(\), readyAt\) \+ TURN_ORDER_INTRO_COMPLETION_RETRY_WINDOW_MS/);
  assert.match(controllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_DELAYS_MS\[attemptIndex\]\s*\?\? TURN_ORDER_INTRO_COMPLETION_RETRY_INTERVAL_MS/);
  assert.match(controllerSource, /if \(Date\.now\(\) \+ retryDelay > retryUntil\) return/);
  assert.match(controllerSource, /if \(cancelled \|\| version\) return;\s*scheduleRetry\(\)/);
});
