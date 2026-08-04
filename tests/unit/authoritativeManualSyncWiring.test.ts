import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');

test('수동 동기화 UI는 로컬 이동 소유권 보호 controller 경로를 사용한다', () => {
  assert.match(
    appSource,
    /syncLatestSequencesFromBadge:\s*syncLatestSequencesFromBadgeWithOwnershipGuard/,
  );
  assert.match(
    appSource,
    /onSyncLatestSequences=\{syncLatestSequencesFromBadgeWithOwnershipGuard\}/,
  );
  assert.doesNotMatch(
    appSource,
    /onSyncLatestSequences=\{syncLatestSequencesFromBadge\}/,
  );
});
