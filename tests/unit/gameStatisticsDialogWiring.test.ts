import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync('src/app/components/GameStatisticsDialog.tsx', 'utf8');
const statisticsSource = readFileSync('src/app/flows/gameStatistics.ts', 'utf8');
const fixtureSource = readFileSync('tests/helpers/game-statistics-fixture.js', 'utf8');
const panelsSource = readFileSync('src/app/containers/GamePanels.tsx', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');
const manifestSource = readFileSync('tests/qa/suite-manifest.mjs', 'utf8');

test('통계 팝업은 전체 Sequence를 조회한 뒤 현재 game_initialized 경계만 집계에 연결한다', () => {
  assert.match(panelsSource, /onOpenSequenceExportDialog[\s\S]{0,500}requestGameStatisticsDialogOpen/u);
  assert.match(panelsSource, /aria-label="통계 정보 열기"/u);
  assert.match(panelsSource, /<svg viewBox="0 0 28 28" aria-hidden="true"/u);
  assert.match(componentSource, /publishGameStatisticsDialogOpenHandler\(openDialog\)/u);
  assert.match(componentSource, /getGameSequencesSince\(roomId, 0\)/u);
  assert.match(componentSource, /getLatestGameState\(roomId\)/u);
  assert.match(componentSource, /const currentGameSequences = selectCurrentGameSequences\(latestState as SyncedGameState \| null, sequences as GameSequence\[\]\)/u);
  assert.match(componentSource, /resolveGameStatisticsSeats\(latestState as SyncedGameState \| null, currentGameSequences\)/u);
  assert.match(componentSource, /buildGameStatistics\(currentGameSequences, seats\)/u);
  assert.match(componentSource, /createPortal\([\s\S]*document\.body/u);
  assert.match(mainSource, /<GameStatisticsHost \/>/u);
  assert.match(mainSource, /game-statistics-dialog\.css/u);
});

test('통계 조회는 request id·room id·열림 상태·언마운트를 함께 검증하고 중복 재시도를 막는다', () => {
  assert.match(componentSource, /requestCounterRef/u);
  assert.match(componentSource, /activeRequest\?\.id !== requestId/u);
  assert.match(componentSource, /activeRequest\.roomId !== roomId/u);
  assert.match(componentSource, /readActiveRoomId\(\) !== roomId/u);
  assert.match(componentSource, /!mountedRef\.current/u);
  assert.match(componentSource, /!dialogOpenRef\.current/u);
  assert.match(componentSource, /loadingRef\.current && activeRequestRef\.current\?\.roomId === roomId/u);
  assert.match(componentSource, /requestCounterRef\.current \+= 1/u);
});

test('통계 순수 헬퍼는 Node 단위 테스트 컴파일에서 브라우저 서비스 배럴을 끌어오지 않는다', () => {
  assert.doesNotMatch(statisticsSource, /features\/room\/services\/roomService/u);
  assert.match(statisticsSource, /export type GameStatisticsSequence/u);
  assert.match(statisticsSource, /export type GameStatisticsStateSource/u);
  assert.match(statisticsSource, /export function selectCurrentGameSequences/u);
});

test('통계 QA fixture는 최신 게임 identity를 전달하고 최초 필수 닉네임 모달을 정상 완료한다', () => {
  assert.match(fixtureSource, /getByRole\('dialog', \{ name: '닉네임 설정' \}\)/u);
  assert.match(fixtureSource, /getByRole\('textbox'\)\.fill\('통계QA'\)/u);
  assert.match(fixtureSource, /getByRole\('button', \{ name: '시작하기' \}\)\.click\(\)/u);
  assert.match(fixtureSource, /waitFor\(\{ state: 'hidden' \}\)/u);
  assert.match(fixtureSource, /latestState = null/u);
  assert.match(fixtureSource, /const inferLatestState = \(configured\) =>/u);
  assert.match(fixtureSource, /gameSeats: configured\.seats, \.\.\.inferLatestState\(configured\)/u);
});

test('Desktop·Mobile 통계 QA가 실제 suite 실행 목록에 연결된다', () => {
  assert.match(manifestSource, /tests\/regression\/game-statistics-dialog\.spec\.js/u);
  assert.match(manifestSource, /tests\/mobile\/game-statistics-dialog\.spec\.js/u);
});

test('통계 배지 class 변환은 ES2020 호환 API를 사용한다', () => {
  assert.doesNotMatch(componentSource, /\.replaceAll\(/u);
  assert.match(componentSource, /replace\(\/\\s\+\/g, '-'\)/u);
});
