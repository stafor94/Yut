import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('새 게임 액션 hot path는 processed action과 state snapshot만 읽는다', () => {
  const service = read('src/features/room/services/roomServiceCore.ts');
  const actionCommit = service.slice(
    service.indexOf('export async function commitAuthoritativeGameAction'),
    service.indexOf('export function subscribePendingGameActions'),
  );
  const fastPath = actionCommit.slice(
    actionCommit.indexOf('if (hasConfigSnapshot)'),
    actionCommit.indexOf('} else {', actionCommit.indexOf('if (hasConfigSnapshot)')),
  );

  assert.match(actionCommit, /transaction\.get\(processedActionRef\)/);
  assert.match(actionCommit, /transaction\.get\(gameStateRef\)/);
  assert.doesNotMatch(fastPath, /transaction\.get/);
  assert.doesNotMatch(fastPath, /'players'/);
  assert.match(actionCommit, /if \(!hasConfigSnapshot\)/);
});

test('일반 액션 커밋은 room lastActivityAt 추가 쓰기를 만들지 않는다', () => {
  const service = read('src/features/room/services/roomService.ts');
  const actionWrapper = service.slice(
    service.indexOf('export async function commitAuthoritativeGameAction'),
    service.indexOf('export async function createRoom'),
  );

  assert.doesNotMatch(actionWrapper, /lastActivityAt/);
  assert.match(service, /ROOM_SUMMARY_HEARTBEAT_INTERVAL_MS = 30_000/);
  assert.match(service, /refreshRoomSummary/);
});

test('게임 도중 AI 대행 전환은 lifecycle 트랜잭션에서 presence epoch와 제어 snapshot을 함께 갱신한다', () => {
  const cleanup = read('src/features/room/services/roomPresenceCleanupService.ts');
  const exit = read('src/features/room/services/roomExitService.ts');
  const join = read('src/features/room/services/roomJoinService.ts');
  const service = read('src/features/room/services/roomService.ts');
  const persistence = read('src/app/hooks/useGameStatePersistence.ts');

  for (const lifecycleService of [cleanup, exit, join]) {
    assert.match(lifecycleService, /updateGameSeatControlState\(gameState\.gameSeats/);
    assert.match(lifecycleService, /transaction\.set\(gameStateRef, \{ gameSeats: nextGameSeats/);
  }
  assert.doesNotMatch(service, /syncGameSeatControlSnapshot/);
  assert.doesNotMatch(persistence, /syncGameSeatControlSnapshot/);
});
