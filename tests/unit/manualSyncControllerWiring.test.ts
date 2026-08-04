import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');
const controllerSource = readFileSync('src/app/controllers/useAuthoritativeGameSyncController.ts', 'utf8');

test('manual sync header uses the controller-protected callback', () => {
  assert.match(appSource, /syncLatestSequencesFromBadge:\s*syncLatestSequencesFromBadgeSafely,/);
  assert.match(appSource, /onSyncLatestSequences=\{syncLatestSequencesFromBadgeSafely\}/);
  assert.doesNotMatch(appSource, /onSyncLatestSequences=\{syncLatestSequencesFromBadge\}/);
});

test('protected manual sync preserves normal sync and suppresses an active local move', () => {
  const wrapperMatch = controllerSource.match(
    /const syncLatestSequencesFromBadge = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/,
  );
  assert.ok(wrapperMatch, 'protected manual sync wrapper should exist');

  const wrapperSource = wrapperMatch[1];
  assert.match(wrapperSource, /const activeLocalMove = localMoveLedger\.findByRoom\(roomId\);/);
  assert.match(wrapperSource, /if \(!activeLocalMove\) \{\s*await params\.syncLatestSequencesFromBadge\(\);\s*return;\s*\}/);
  assert.match(wrapperSource, /if \(activeLocalMove\.hardResyncStarted\) \{\s*await runLocalMoveHardResync\(/);
  assert.equal(
    wrapperSource.match(/params\.syncLatestSequencesFromBadge\(\)/g)?.length,
    1,
    'the raw sequence sync should only run when no local move owns presentation',
  );
});
