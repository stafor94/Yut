import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const helperSource = fs.readFileSync(path.join(root, 'tests/helpers/room-access.js'), 'utf8');
const pointerSpecSource = fs.readFileSync(path.join(root, 'tests/mobile/roll-timing-pointer-capture.spec.js'), 'utf8');

test('Firebase Auth 토큰과 QA cleanup 권한은 고정 5초가 아니라 실제 준비 조건까지 제한적으로 polling한다', () => {
  assert.match(helperSource, /DEFAULT_ROOM_ACCESS_TIMEOUT_MS = 15_000/u);
  assert.match(helperSource, /while \(Date\.now\(\) - startedAt < normalizedTimeoutMs\)/u);
  assert.match(helperSource, /rememberRoomIdFromPage\(page\)/u);
  assert.match(helperSource, /findRoomIdByTitle\(roomTitle\)/u);
  assert.match(helperSource, /DEFAULT_ROOM_ACCESS_INTERVALS_MS/u);
  assert.match(helperSource, /lastError/u);

  assert.match(pointerSpecSource, /import \{ waitForRoomQaAccess \} from '\.\.\/helpers\/room-access\.js';/u);
  assert.match(pointerSpecSource, /resolvedRoomId = await waitForRoomQaAccess\(page, \{ roomTitle \}\);/u);
  assert.doesNotMatch(pointerSpecSource, /Firebase Auth 토큰과 QA cleanup 권한[\s\S]{0,300}timeout:\s*5_000/u);
  assert.doesNotMatch(pointerSpecSource, /rememberRoomIdFromPage/u);
});
