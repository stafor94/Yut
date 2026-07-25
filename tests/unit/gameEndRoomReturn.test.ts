import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isActiveHumanRoomHost } from '../../src/app/flows/gameEndRoomReturn.js';

test('대기실 또는 인게임에 남아 있는 사람 방장은 활성 방장으로 판정한다', () => {
  const activeHumanHost = { isAI: false, isSubstitutedByAI: false, isSpectator: false };
  assert.equal(isActiveHumanRoomHost(activeHumanHost), true);
  assert.equal(isActiveHumanRoomHost({ ...activeHumanHost }), true);
});

test('나간 뒤 AI로 대체됐거나 방에 없는 방장은 방 삭제와 기존 종료 알림 경로를 사용한다', () => {
  assert.equal(isActiveHumanRoomHost({ isAI: true, isSubstitutedByAI: true, isSpectator: false }), false);
  assert.equal(isActiveHumanRoomHost({ isAI: true, isSubstitutedByAI: false, isSpectator: false }), false);
  assert.equal(isActiveHumanRoomHost({ isAI: false, isSubstitutedByAI: false, isSpectator: true }), false);
  assert.equal(isActiveHumanRoomHost(null), false);

  const lifecycleSource = readFileSync('src/app/controllers/useGameLifecycleController.ts', 'utf8');
  const subscriptionSource = readFileSync('src/app/controllers/useRoomPlayersSubscription.ts', 'utf8');
  assert.match(lifecycleSource, /authoritativeHostPlayer = await getRoomPlayer/);
  assert.match(lifecycleSource, /await deleteRoom\(finishedRoomId\)/);
  assert.match(lifecycleSource, /publishRoomNotice\(\{ title: '방장이 방을 나갔습니다\.'/);
  assert.match(subscriptionSource, /subscribeRoomNotice\(setRoomNoticeDialog\)/);
});

test('윷판 메시지는 일반 차례 안내를 숨기고 한 번 더 안내만 유지한다', () => {
  const source = readFileSync('src/app/containers/GameBoardOverlays.tsx', 'utf8');
  assert.match(source, /turnToast\?\.text === '한 번 더!'/);
  assert.match(source, /visibleTurnToast && <div className="turn-toast board-toast"/);
});

test('강퇴 버튼은 AI 제거 버튼과 같은 높이 변수를 사용한다', () => {
  const source = readFileSync('src/styles/control-geometry.css', 'utf8');
  assert.match(source, /\.seat-status-actions \.kick-player-button[\s\S]*height: var\(--waiting-ai-action-height\);[\s\S]*min-height: var\(--waiting-ai-action-height\);/);
});
