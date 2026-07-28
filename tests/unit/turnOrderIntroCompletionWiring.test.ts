import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controllerSource = readFileSync('src/app/controllers/useGameStartController.ts', 'utf8');

function sourceBetween(startMarker: string, endMarker: string) {
  const start = controllerSource.indexOf(startMarker);
  const end = controllerSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} 시작점을 찾지 못했습니다.`);
  assert.ok(end > start, `${endMarker} 종료점을 찾지 못했습니다.`);
  return controllerSource.slice(start, end);
}

test('온라인 순서 정하기 presentation은 authoritative 완료 전 로컬 intro를 삭제하지 않는다', () => {
  const presentationEffect = sourceBetween(
    'useTurnOrderPortraitScroll(ctx.screen, ctx.turnOrderPhase.active || Boolean(ctx.activeTurnOrderIntro));',
    'if (!ctx.activeRoomId || !ctx.canCompleteInitialOnlineTurnOrderIntro',
  );

  assert.match(presentationEffect, /if \(ctx\.activeRoomId\) \{[\s\S]*visible: false[\s\S]*return;/);
  assert.match(presentationEffect, /setTurnOrderIntro\(null\);[\s\S]*setGameStartedAt/);
  assert.ok(presentationEffect.indexOf('if (ctx.activeRoomId)') < presentationEffect.indexOf('setTurnOrderIntro(null)'));
  assert.match(presentationEffect, /\[ctx\.activeRoomId, ctx\.turnOrderIntro\?\.readyAt\]/);
});

test('authoritative 순서 정하기 완료는 coordinator 복구와 일시적 transaction 충돌을 제한 재시도한다', () => {
  const completionEffect = sourceBetween(
    'if (!ctx.activeRoomId || !ctx.canCompleteInitialOnlineTurnOrderIntro',
    'if (!ctx.startCountdownEffectActive)',
  );

  assert.match(controllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_DELAYS_MS = \[250, 500, 1_000, 2_000\] as const/);
  assert.match(completionEffect, /const timers = new Set<number>\(\)/);
  assert.match(completionEffect, /const scheduleCompletion = \(attemptIndex: number, delayMs: number\)/);
  assert.match(completionEffect, /completeTurnOrderIntro\(ctx\.activeRoomId, \{ readyAt, actorId: ctx\.localSeatId, coordinatorEpoch: ctx\.coordinatorEpoch \}\)/);
  assert.match(completionEffect, /if \(cancelled \|\| version\) return/);
  assert.match(completionEffect, /TURN_ORDER_INTRO_COMPLETION_RETRY_DELAYS_MS\[attemptIndex\]/);
  assert.match(completionEffect, /scheduleCompletion\(attemptIndex \+ 1, retryDelay\)/);
  assert.match(completionEffect, /cancelled = true;[\s\S]*timers\.forEach\(\(timer\) => window\.clearTimeout\(timer\)\)/);
  assert.match(completionEffect, /ctx\.canCompleteInitialOnlineTurnOrderIntro/);
  assert.match(completionEffect, /ctx\.turnOrderIntro\?\.readyAt/);
});
