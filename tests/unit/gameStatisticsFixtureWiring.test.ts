import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixtureSource = readFileSync('tests/helpers/game-statistics-fixture.js', 'utf8');

test('통계 QA fixture는 누락된 활성 방만 복구하고 실제 방 전환은 보존한다', () => {
  assert.match(fixtureSource, /const setActiveRoomId = \(roomId\) => window\.localStorage\.setItem\('yut-online:activeRoomId', roomId\);/u);
  assert.match(fixtureSource, /const restoreActiveRoomIdIfMissing = \(roomId\) => \{\s*if \(!window\.localStorage\.getItem\('yut-online:activeRoomId'\)\?\.trim\(\)\) setActiveRoomId\(roomId\);\s*\};/u);
  assert.match(fixtureSource, /statisticsButton\.addEventListener\('click', \(\) => \{\s*setActiveRoomId\(nextRoomId\);\s*window\.__YUT_QA_OPEN_GAME_STATISTICS__\?\.\(\);\s*\}\);/u);

  const loaderDelayIndex = fixtureSource.indexOf('await new Promise');
  const missingRoomRestoreIndex = fixtureSource.indexOf('restoreActiveRoomIdIfMissing(requestedRoomId);');
  const recoverableFailureIndex = fixtureSource.indexOf('if (window.__YUT_QA_GAME_STATISTICS_FAILURES_LEFT__ > 0)');
  const loaderReturnIndex = fixtureSource.indexOf('return [{ gameSeats: configured.seats, ...inferLatestState(configured) }, configured.sequences];');

  assert.ok(loaderDelayIndex >= 0);
  assert.ok(missingRoomRestoreIndex > loaderDelayIndex);
  assert.ok(recoverableFailureIndex > missingRoomRestoreIndex);
  assert.ok(loaderReturnIndex > recoverableFailureIndex);
});
