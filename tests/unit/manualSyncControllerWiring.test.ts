import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');

test('manual sync header uses the controller-protected callback', () => {
  assert.match(appSource, /syncLatestSequencesFromBadge:\s*syncLatestSequencesFromBadgeSafely,/);
  assert.match(appSource, /onSyncLatestSequences=\{syncLatestSequencesFromBadgeSafely\}/);
  assert.doesNotMatch(appSource, /onSyncLatestSequences=\{syncLatestSequencesFromBadge\}/);
});
