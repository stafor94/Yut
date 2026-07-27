import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');
const screenSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');
const screenLayoutSource = readFileSync('src/app/screens/GameScreen.tsx', 'utf8');
const controlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const playersSource = readFileSync('src/app/containers/GamePanels.tsx', 'utf8');
const autoPlayStyles = readFileSync('src/styles/auto-play-controls.css', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');
const manifestSource = readFileSync('tests/qa/suite-manifest.mjs', 'utf8');

test('timeout 자동 플레이는 기존 어려움 AI 제출 경로에 명시적 automation source를 연결한다', () => {
  assert.match(appSource, /const getAiAutomationPayload = \(seat: Seat\) => autoPlayBySeatIdRef\.current\[seat\.id\]/);
  assert.match(appSource, /automationSource: 'timeout_ai'/);
  assert.match(appSource, /activeSeat\?\.isAI \|\| activeSeatAutoPlay/);
  assert.match(appSource, /void autoPlayTurn\(activeSeat, actionKey\)/);
});

test('BoardPanel은 기존 안내 element를 렌더링하지 않고 같은 play-controls 슬롯의 상태 패널로 교체한다', () => {
  assert.match(screenSource, /data-testid="auto-play-overlay"/);
  assert.match(screenLayoutSource, /child\.props\['data-testid'\] === 'auto-play-overlay'/);
  assert.match(screenLayoutSource, /if \(child === autoPlayOverlay\) return null/);
  assert.match(screenLayoutSource, /autoPlayOverlay && isBoardControls\(child\)/);
  assert.match(screenLayoutSource, /data-testid="play-controls"/);
  assert.match(screenLayoutSource, /className="play-controls auto-play-mode"/);
  assert.match(screenLayoutSource, /data-testid="auto-play-control-panel"/);
  assert.match(screenLayoutSource, /autoPlayOverlay\.props\.children/);
});

test('자동 플레이 상태에서는 GameBoardControls 직접 조작 subtree를 렌더링하지 않는다', () => {
  const replacementIndex = screenLayoutSource.indexOf('autoPlayOverlay && isBoardControls(child)');
  const childReturnIndex = screenLayoutSource.indexOf('return child;', replacementIndex);
  assert.ok(replacementIndex >= 0);
  assert.ok(childReturnIndex > replacementIndex);
  assert.match(controlsSource, /autoPlayActive \? <button data-testid="auto-play-active-button"/);
  assert.match(screenSource, /data-testid="resume-human-control-button"/);
  assert.match(screenSource, /disabled=\{resumeHumanControlPending\}/);
  assert.match(screenSource, /통제권 가져오는 중\.\.\./);
  assert.match(playersSource, /AI 자동 플레이/);
});

test('자동 플레이 패널은 viewport overlay positioning 없이 기존 조작 영역 높이를 유지한다', () => {
  assert.doesNotMatch(autoPlayStyles, /position:\s*(?:fixed|absolute)/);
  assert.match(autoPlayStyles, /\.play-controls\.auto-play-mode \{[\s\S]*min-height: 76px/);
  assert.match(autoPlayStyles, /@media \(max-width: 767px\) \{[\s\S]*\.play-controls\.auto-play-mode \{[\s\S]*min-height: 132px/);
  assert.match(autoPlayStyles, /resume-human-control-button/);
  assert.match(mainSource, /import '\.\/styles\/auto-play-controls\.css';/);
});

test('Galaxy 자동 플레이 스크롤 회귀 테스트는 실제 mobile-galaxy QA 목록에 연결된다', () => {
  assert.match(manifestSource, /'mobile-galaxy':[\s\S]*'tests\/mobile\/auto-play-controls-scroll\.spec\.js'/);
});
