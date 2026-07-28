import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sequenceQaSource = readFileSync('tests/regression/bug-history-smoke.spec.js', 'utf8');
const timingQaSource = readFileSync('tests/mobile/roll-timing-pointer-capture.spec.js', 'utf8');
const roomAccessSource = readFileSync('tests/helpers/room-access.js', 'utf8');

test('AI sequence 회귀 QA는 대상 이동 검증 전에 비결정적 순서 정하기 동률을 제거한다', () => {
  const targetTestStart = sequenceQaSource.indexOf("test('host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다'");
  const targetTestSource = sequenceQaSource.slice(targetTestStart);

  assert.ok(targetTestStart >= 0);
  assert.match(targetTestSource, /__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = \['모'\]/);
  assert.match(targetTestSource, /__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = \['도'\]/);
  assert.ok(targetTestSource.indexOf('__YUT_QA_TURN_ORDER_RESULT_QUEUE__') < targetTestSource.indexOf('createRoomFromLobby'));
});

test('WebKit 타이밍 QA는 방 cleanup 권한용 Firebase Auth 토큰을 실제 준비 조건으로 제한 polling한다', () => {
  const timingGameStart = timingQaSource.indexOf('async function startAiTimingGame');
  const timingGameEnd = timingQaSource.indexOf('async function dispatchPointerDownSnapshotGesture');
  const timingGameSource = timingQaSource.slice(timingGameStart, timingGameEnd);

  assert.ok(timingGameStart >= 0);
  assert.ok(timingGameEnd > timingGameStart);
  assert.match(timingQaSource, /import \{ waitForRoomQaAccess \} from '\.\.\/helpers\/room-access\.js';/);
  assert.match(timingGameSource, /resolvedRoomId = await waitForRoomQaAccess\(page, \{ roomTitle \}\);/);
  assert.ok(timingGameSource.indexOf('waitForRoomQaAccess(page') < timingGameSource.indexOf('addAiAndWaitUntilGameCanStart(page)'));
  assert.doesNotMatch(timingGameSource, /rememberRoomIdFromPage/);
  assert.doesNotMatch(timingGameSource, /timeout:\s*5_000/);

  assert.match(roomAccessSource, /DEFAULT_ROOM_ACCESS_TIMEOUT_MS = 15_000/);
  assert.match(roomAccessSource, /DEFAULT_ROOM_ACCESS_INTERVALS_MS = Object\.freeze\(\[100, 200, 400, 800, 1200\]\)/);
  assert.match(roomAccessSource, /while \(Date\.now\(\) - startedAt < normalizedTimeoutMs\)/);
  assert.match(roomAccessSource, /rememberRoomIdFromPage\(page\)/);
  assert.match(roomAccessSource, /findRoomIdByTitle\(roomTitle\)/);
  assert.match(roomAccessSource, /Firebase Auth 토큰과 QA cleanup 권한이 준비되지 않았습니다/);
});
