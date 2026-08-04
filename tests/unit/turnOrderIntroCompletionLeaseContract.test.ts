import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controllerSource = readFileSync('src/app/controllers/useGameStartController.ts', 'utf8');

test('online turn-order intro completion refreshes coordinator lease before committing', () => {
  assert.match(controllerSource, /claimGameCoordinatorLease, GAME_COORDINATOR_RETRY_MS/);
  assert.match(controllerSource, /if \(!ctx\.activeRoomId \|\| ctx\.screen !== 'game' \|\| !ctx\.turnOrderIntro\?\.readyAt \|\| !ctx\.localSeatId\) return undefined;/);
  assert.doesNotMatch(controllerSource, /!ctx\.canCompleteInitialOnlineTurnOrderIntro/);
  assert.match(controllerSource, /if \(Date\.now\(\) < readyAt\) \{\s*scheduleCompletion\(attemptIndex, Math\.max\(0, readyAt - Date\.now\(\)\)\);/);
  assert.ok(
    controllerSource.indexOf('await claimGameCoordinatorLease(ctx.activeRoomId, ctx.localSeatId)')
      < controllerSource.indexOf('await completeTurnOrderIntro(ctx.activeRoomId'),
    'the completion path must refresh or acquire the coordinator lease before committing the intro completion',
  );
  assert.match(controllerSource, /coordinatorEpoch: lease\.coordinatorEpoch/);
});

test('turn-order intro completion keeps retrying at the coordinator retry cadence until authoritative completion', () => {
  assert.match(controllerSource, /TURN_ORDER_INTRO_COMPLETION_RETRY_DELAYS_MS\[attemptIndex\] \?\? GAME_COORDINATOR_RETRY_MS/);
  assert.match(controllerSource, /if \(cancelled \|\| version\) return;\s*scheduleCompletion\(attemptIndex \+ 1, getRetryDelay\(attemptIndex\)\);/);
  assert.match(controllerSource, /\[ctx\.activeRoomId, ctx\.localSeatId, ctx\.screen, ctx\.turnOrderIntro\?\.readyAt\]/);
});
