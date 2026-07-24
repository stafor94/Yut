import { test, expect } from '@playwright/test';
import { createRoomFromLobby, primeLobbyStorage } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('turn-order roll placement and confirmed rank QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('Galaxy 세로 화면에서 윷 애니메이션을 윷판에 맞추고 확정 순서 번호를 표시한다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'turn-order-placement'));
    const roomTitle = makeQaName(testInfo, 'turn-order-placement-room');
    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '3',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도', '도', '걸', '개'];
    });

    await createRoomFromLobby(page, roomTitle);
    roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
    await page.getByTestId('add-ai-P2').click();
    await page.getByTestId('add-ai-P3').click();
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('start-game-button').click();
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

    const rollButton = page.getByTestId('turn-order-roll-button');
    await expect(rollButton).toBeVisible({ timeout: 10_000 });
    await rollButton.click();

    const rollStage = page.locator('.board-panel > .roll-stage');
    await expect(rollStage).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('roll-mat')).toBeVisible();
    const layout = await rollStage.evaluate((stage) => {
      const board = stage.parentElement?.querySelector('[data-testid="game-board"]');
      if (!(board instanceof HTMLElement)) throw new Error('순서 정하기 윷판을 찾지 못했습니다.');
      const stageRect = stage.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      return {
        position: getComputedStyle(stage).position,
        topOffset: Math.abs(stageRect.top - boardRect.top),
        leftOffset: Math.abs(stageRect.left - boardRect.left),
        widthOffset: Math.abs(stageRect.width - boardRect.width),
        heightOffset: Math.abs(stageRect.height - boardRect.height),
      };
    });
    expect(layout.position, '세로 화면의 순서 정하기 윷 애니메이션은 fixed 레이어를 사용해야 합니다.').toBe('fixed');
    expect(layout.topOffset, 'fixed 윷 애니메이션의 top은 뷰포트 기준 윷판 top과 일치해야 합니다.').toBeLessThanOrEqual(1);
    expect(layout.leftOffset, 'fixed 윷 애니메이션의 left는 뷰포트 기준 윷판 left와 일치해야 합니다.').toBeLessThanOrEqual(1);
    expect(layout.widthOffset).toBeLessThanOrEqual(1);
    expect(layout.heightOffset).toBeLessThanOrEqual(1);

    await expect(page.getByTestId('turn-order-own-result')).toContainText('모');
    await expect(page.getByTestId('turn-order-spectating')).toBeVisible({ timeout: 25_000 });
    const ownCard = page.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: nickname });
    await expect(ownCard).toContainText('1번째');
    await expect(ownCard).toContainText('순서 확정');
    await expect(ownCard).not.toContainText('순위 확정');
  });
});
