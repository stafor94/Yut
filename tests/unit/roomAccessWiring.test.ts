import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const roomAccessSource = readFileSync('tests/helpers/room-access.js', 'utf8');
const statisticsSpecSource = readFileSync('tests/regression/game-statistics-dialog.spec.js', 'utf8');

test('room access는 한 번의 브라우저 토큰 조회가 전체 deadline을 점유하지 못하게 한다', () => {
  assert.match(roomAccessSource, /DEFAULT_ROOM_ACCESS_ATTEMPT_TIMEOUT_MS = 1_500/u);
  assert.match(roomAccessSource, /Promise\.race\(\[\s*rememberRoomIdFromPage\(page\)/u);
  assert.match(roomAccessSource, /attempt \+= 1;[\s\S]{0,250}rememberRoomIdWithAttemptTimeout/u);
  assert.match(roomAccessSource, /Math\.min\(DEFAULT_ROOM_ACCESS_ATTEMPT_TIMEOUT_MS, remainingBeforeAttemptMs\)/u);
  assert.match(roomAccessSource, /pollIntervals\[Math\.min\(attempt - 1, pollIntervals\.length - 1\)\]/u);
});

test('통계 팝업 QA는 생략 가능한 로딩 순간 대신 요청 시작과 최종 결과를 검증한다', () => {
  assert.doesNotMatch(statisticsSpecSource, /game-statistics-loading/u);
  assert.match(statisticsSpecSource, /__YUT_QA_GAME_STATISTICS_LOADER_CALLS__\.length\)\)\.toBe\(1\)/u);
  assert.match(statisticsSpecSource, /getByTestId\('game-statistics-dialog'\)/u);
});
