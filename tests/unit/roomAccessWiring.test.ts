import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const roomAccessSource = readFileSync('tests/helpers/room-access.js', 'utf8');
const statisticsSpecSource = readFileSync('tests/regression/game-statistics-dialog.spec.js', 'utf8');

test('room access는 한 번의 브라우저 토큰 조회가 전체 deadline을 점유하지 못하게 한다', () => {
  assert.match(roomAccessSource, /DEFAULT_ROOM_ACCESS_ATTEMPT_TIMEOUT_MS = 1_500/u);
  assert.match(roomAccessSource, /Promise\.race\(\[\s*rememberRoomIdFromPage\(roomAccessPage\)/u);
  assert.match(roomAccessSource, /attempt \+= 1;[\s\S]{0,500}rememberRoomIdWithAttemptTimeout/u);
  assert.match(roomAccessSource, /Math\.min\(DEFAULT_ROOM_ACCESS_ATTEMPT_TIMEOUT_MS, remainingBeforeAttemptMs\)/u);
  assert.match(roomAccessSource, /pollIntervals\[Math\.min\(attempt - 1, pollIntervals\.length - 1\)\]/u);
});

test('room access는 화면 방 제목이 일치할 때만 Firestore room id를 토큰 조회 fallback으로 사용한다', () => {
  assert.match(roomAccessSource, /const roomAccessPage = fallbackRoomId[\s\S]{0,400}__YUT_DEBUG_STATE__\?\.activeRoomId[\s\S]{0,250}: page;/u);
  assert.match(roomAccessSource, /const fallbackRoomId = firestoreRoomId && displayedRoomTitle === roomTitle \? firestoreRoomId : '';/u);
  assert.match(roomAccessSource, /rememberRoomIdWithAttemptTimeout\([\s\S]{0,180}fallbackRoomId,[\s\S]{0,40}\);/u);
});

test('Safari room access는 cleanup 토큰 확보 후 현재 페이지와 Firestore 연결을 유지한다', () => {
  assert.doesNotMatch(roomAccessSource, /page\.reload\(/u);
  assert.doesNotMatch(roomAccessSource, /stabilizeSafariPointerRoomAccess/u);
  assert.match(roomAccessSource, /if \(roomId\) \{\s*await installSafariTimingStartRetry\(page\);\s*return roomId;/u);
});

test('통계 팝업 QA는 생략 가능한 로딩 순간 대신 요청 시작과 최종 결과를 검증한다', () => {
  assert.doesNotMatch(statisticsSpecSource, /game-statistics-loading/u);
  assert.match(statisticsSpecSource, /__YUT_QA_GAME_STATISTICS_LOADER_CALLS__\.length\)\)\.toBe\(1\)/u);
  assert.match(statisticsSpecSource, /getByTestId\('game-statistics-dialog'\)/u);
});
