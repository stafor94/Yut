import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixtureSource = readFileSync('tests/helpers/game-statistics-fixture.js', 'utf8');

test('통계 QA fixture는 팝업 열기와 loader 완료 직전에 활성 방 ID를 복구한다', () => {
  assert.match(fixtureSource, /const restoreActiveRoomId = \(roomId\) => window\.localStorage\.setItem\('yut-online:activeRoomId', roomId\);/u);
  assert.match(fixtureSource, /statisticsButton\.addEventListener\('click', \(\) => \{\s*restoreActiveRoomId\(nextRoomId\);\s*window\.__YUT_QA_OPEN_GAME_STATISTICS__\?\.\(\);\s*\}\);/u);

  const loaderDelayIndex = fixtureSource.indexOf('await new Promise');
  const requestedRoomRestoreIndex = fixtureSource.indexOf('restoreActiveRoomId(requestedRoomId);');
  const recoverableFailureIndex = fixtureSource.indexOf('if (window.__YUT_QA_GAME_STATISTICS_FAILURES_LEFT__ > 0)');
  const loaderReturnIndex = fixtureSource.indexOf('return [{ gameSeats: configured.seats }, configured.sequences];');

  assert.ok(loaderDelayIndex >= 0);
  assert.ok(requestedRoomRestoreIndex > loaderDelayIndex);
  assert.ok(recoverableFailureIndex > requestedRoomRestoreIndex);
  assert.ok(loaderReturnIndex > recoverableFailureIndex);
});
