import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

async function addAiAndWaitUntilGameCanStart(page, seatLabel = 'P2') {
  const addAiButton = page.getByTestId(`add-ai-${seatLabel}`);
  await expect(addAiButton, `${seatLabel} AI 추가 버튼이 대기실 동기화 후 표시되어야 합니다.`).toBeVisible({ timeout: 15_000 });
  await addAiButton.click();
  await expect(addAiButton, `${seatLabel} AI 추가가 완료되면 빈 자리 버튼이 사라져야 합니다.`).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('start-game-button'), 'AI 참가 상태가 반영된 뒤 게임 시작 버튼이 활성화되어야 합니다.').toBeEnabled({ timeout: 15_000 });
}


test.describe('BUG_HISTORY regression smoke', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('게임 시작 직후 윷 던지기/대기 버튼 상태가 고착되지 않는다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'reg-host'));
    const roomTitle = makeQaName(testInfo, 'reg-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, 'AI 게임 시작', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await addAiAndWaitUntilGameCanStart(page);
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '턴 컨트롤 상태 진단', async () => {
      const state = await collectScreenState(page);
      expect(
        state.rollButton.visible || state.moveButton.visible || state.turnWaitingButton.visible,
        `턴 컨트롤이 없는 상태입니다: ${JSON.stringify(state, null, 2)}`,
      ).toBe(true);
    });
  });

});
