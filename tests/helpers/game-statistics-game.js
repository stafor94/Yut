import { expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, primeTurnOrderResultQueues } from './ui.js';
import { makeQaName, normalizeQaNickname } from './env.js';
import { findRoomIdByTitle, getRoomSequencesForQa, rememberRoomIdFromPage } from './rooms.js';

export async function startGameStatisticsQaGame(page, context, testInfo, { playerCount = 2 } = {}) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'stats'));
  const roomTitle = makeQaName(testInfo, `stats-${playerCount}`);
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: String(playerCount),
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await primeTurnOrderResultQueues(context, {
    human: ['모'],
    ai: ['도', '개', '걸'].slice(0, Math.max(1, playerCount - 1)),
  });

  await createRoomFromLobby(page, roomTitle);
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('통계 QA 방 ID를 찾지 못했습니다.');

  for (let seatNumber = 2; seatNumber <= playerCount; seatNumber += 1) {
    const addAiButton = page.getByTestId(`add-ai-P${seatNumber}`);
    await expect(addAiButton).toBeVisible({ timeout: 15_000 });
    await expect(addAiButton).toBeEnabled({ timeout: 15_000 });
    await addAiButton.click();
  }

  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 45_000 });

  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    const orderResolved = Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === playerCount
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro
      && !state.turnOrder.phaseOverlayVisible
      && !state.turnOrder.introOverlayVisible
      && !state.turnOrder.lockVisible;
    return orderResolved && state.rollButton.visible && !state.rollButton.disabled;
  }, {
    timeout: 45_000,
    message: '통계 QA에서 내 차례의 윷 던지기 UI가 준비되어야 합니다.',
  }).toBe(true);

  await page.getByTestId('roll-yut-button').click();
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.some((sequence) => sequence.type === 'roll_yut' && sequence.actorId);
  }, { timeout: 20_000, message: '통계 팝업 검증용 roll_yut Sequence가 저장되어야 합니다.' }).toBe(true);

  return { hostName, roomId, roomTitle };
}
