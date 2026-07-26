import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');
const screenSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');
const playersSource = readFileSync('src/app/containers/GamePanels.tsx', 'utf8');
const overlayStyles = readFileSync('src/styles/overlays.css', 'utf8');

test('timeout 자동 플레이는 기존 어려움 AI 제출 경로에 명시적 automation source를 연결한다', () => {
  assert.match(appSource, /const getAiAutomationPayload = \(seat: Seat\) => autoPlayBySeatIdRef\.current\[seat\.id\]/);
  assert.match(appSource, /automationSource: 'timeout_ai'/);
  assert.match(appSource, /activeSeat\?\.isAI \|\| activeSeatAutoPlay/);
  assert.match(appSource, /void autoPlayTurn\(activeSeat, actionKey\)/);
});

test('윷판 자동 플레이 안내와 직접 플레이 복귀 버튼을 모든 화면에 동기화한다', () => {
  assert.match(screenSource, /data-testid="auto-play-overlay"/);
  assert.match(screenSource, /AI 자동 플레이 중\.\.\./);
  assert.match(screenSource, /어려움 AI가 대신 판단합니다/);
  assert.match(screenSource, /data-testid="resume-human-control-button"/);
  assert.match(screenSource, /직접 플레이로 돌아가기/);
  assert.match(playersSource, /AI 자동 플레이/);
});

test('통제권 회수 버튼은 윷판 하단 전체 폭과 모바일 safe area를 사용한다', () => {
  assert.match(overlayStyles, /\.auto-play-overlay button \{[\s\S]*width: 100%/);
  assert.match(overlayStyles, /@media \(max-width: 767px\) \{[\s\S]*bottom: max\(14px, env\(safe-area-inset-bottom\)\)/);
});
