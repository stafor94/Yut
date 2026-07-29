import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const timerHookSource = readFileSync('src/app/hooks/useTurnOrderTimers.ts', 'utf8');
const startControllerSource = readFileSync('src/app/controllers/useGameStartController.ts', 'utf8');

test('순서 정하기 중에는 제한된 heartbeat로 절대 시각 deadline을 다시 평가한다', () => {
  assert.match(timerHookSource, /const TURN_ORDER_INTRO_HEARTBEAT_MS = 250;/);
  assert.match(timerHookSource, /if \(screen !== 'game' \|\| !shouldScrollForTurnOrder\) return undefined;/);
  assert.match(timerHookSource, /window\.setInterval\(\(\) => setHeartbeatAt\(Date\.now\(\)\), TURN_ORDER_INTRO_HEARTBEAT_MS\)/);
  assert.match(timerHookSource, /window\.clearInterval\(heartbeatTimer\)/);
  assert.match(timerHookSource, /if \(scrollTimer !== null\) window\.clearTimeout\(scrollTimer\)/);
});

test('기존 authoritative 완료 timer와 제한 재시도 계약은 유지한다', () => {
  assert.match(startControllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_DELAYS_MS = \[250, 500, 1_000, 2_000\]/);
  assert.match(startControllerSource, /scheduleCompletion\(0, Math\.max\(0, readyAt - Date\.now\(\)\)\)/);
  assert.match(startControllerSource, /completeTurnOrderIntro\(ctx\.activeRoomId, \{ readyAt, actorId: ctx\.localSeatId, coordinatorEpoch: ctx\.coordinatorEpoch \}\)/);
  assert.doesNotMatch(timerHookSource, /TURN_ORDER_INTRO_HEARTBEAT_MS\s*=\s*(?:[5-9]\d{2,}|\d{4,})/);
});
