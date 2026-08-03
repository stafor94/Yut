import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');
const screenSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');
const controlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
const playersSource = readFileSync('src/app/containers/GamePanels.tsx', 'utf8');
const autoPlayStyles = readFileSync('src/styles/auto-play-controls.css', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');

test('timeout 자동 플레이는 기존 어려움 AI 제출 경로에 명시적 automation source를 연결한다', () => {
  assert.match(appSource, /const getAiAutomationPayload = \(seat: Seat\) => autoPlayBySeatIdRef\.current\[seat\.id\]/);
  assert.match(appSource, /automationSource: 'timeout_ai'/);
  assert.match(appSource, /activeSeat\?\.isAI \|\| activeSeatAutoPlay/);
  assert.match(appSource, /void autoPlayTurn\(activeSeat, actionKey\)/);
});

test('GameScreenView는 플로팅 자동 플레이 오버레이를 제거하고 상태 계약을 조작 영역에 전달한다', () => {
  assert.doesNotMatch(screenSource, /data-testid="auto-play-overlay"/);
  assert.doesNotMatch(screenSource, /className="auto-play-overlay"/);
  assert.match(screenSource, /autoPlayActive=\{Boolean\(autoPlayNoticeSeat\)\}/);
  assert.match(screenSource, /autoPlaySeatName=\{autoPlayNoticeSeat \? getPlayerCardName\(autoPlayNoticeSeat\) : ''\}/);
  assert.match(screenSource, /localAutoPlayActive=\{localAutoPlayActive\}/);
  assert.match(screenSource, /resumeHumanControlPending=\{resumeHumanControlPending\}/);
  assert.match(screenSource, /onResumeHumanControl=\{onResumeHumanControl\}/);
  assert.match(playersSource, /AI 자동 플레이/);
});

test('GameBoardControls는 자동 플레이 분기를 직접 조작 UI보다 우선하고 로컬 좌석만 복귀를 허용한다', () => {
  assert.match(controlsSource, /data-testid="play-controls"/);
  assert.match(controlsSource, /autoPlayActive \? <div data-testid="auto-play-control-panel"/);
  assert.match(controlsSource, /AI 자동 플레이 중\.\.\./);
  assert.match(controlsSource, /\{autoPlaySeatName\}님의 행동을 어려움 AI가 대신 판단합니다\./);
  assert.match(controlsSource, /\{localAutoPlayActive && <button/);
  assert.match(controlsSource, /data-testid="resume-human-control-button"/);
  assert.match(controlsSource, /onClick=\{onResumeHumanControl\}/);
  assert.match(controlsSource, /disabled=\{resumeHumanControlPending\}/);
  assert.match(controlsSource, /resumeHumanControlPending \? '통제권 가져오는 중\.\.\.' : '직접 플레이로 돌아가기'/);
  assert.match(controlsSource, /autoPlayActive \? <div[\s\S]*: seatTransitionPhase === 'ending'/);
});

test('자동 플레이 상태 패널은 play-controls 크기를 재사용하고 viewport positioning을 사용하지 않는다', () => {
  assert.match(mainSource, /import '\.\/styles\/auto-play-controls\.css';/);
  assert.match(autoPlayStyles, /\.play-controls\.auto-play-mode/);
  assert.match(autoPlayStyles, /\.auto-play-control-panel/);
  assert.match(autoPlayStyles, /\.resume-human-control-button/);
  assert.doesNotMatch(autoPlayStyles, /position:\s*(?:fixed|absolute)/);
  assert.doesNotMatch(autoPlayStyles, /safe-area-inset-bottom|translateX|z-index/);
});
