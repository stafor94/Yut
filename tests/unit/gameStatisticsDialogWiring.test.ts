import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync('src/app/components/GameStatisticsDialog.tsx', 'utf8');
const panelsSource = readFileSync('src/app/containers/GamePanels.tsx', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');
const manifestSource = readFileSync('tests/qa/suite-manifest.mjs', 'utf8');

test('통계 팝업은 실제 진행 기록 헤더 버튼에 연결되고 authoritative Sequence 전체를 다시 조회한다', () => {
  assert.match(panelsSource, /onOpenSequenceExportDialog[\s\S]{0,500}requestGameStatisticsDialogOpen/u);
  assert.match(panelsSource, /aria-label="통계 정보 열기"/u);
  assert.match(panelsSource, /<svg viewBox="0 0 28 28" aria-hidden="true"/u);
  assert.match(componentSource, /publishGameStatisticsDialogOpenHandler\(openDialog\)/u);
  assert.match(componentSource, /getGameSequencesSince\(roomId, 0\)/u);
  assert.match(componentSource, /getLatestGameState\(roomId\)/u);
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

test('Desktop·Mobile 통계 QA가 실제 suite 실행 목록에 연결된다', () => {
  assert.match(manifestSource, /tests\/regression\/game-statistics-dialog\.spec\.js/u);
  assert.match(manifestSource, /tests\/mobile\/game-statistics-dialog\.spec\.js/u);
});

test('통계 배지 class 변환은 ES2020 호환 API를 사용한다', () => {
  assert.doesNotMatch(componentSource, /\.replaceAll\(/u);
  assert.match(componentSource, /replace\(\/\\s\+\/g, '-'\)/u);
});
