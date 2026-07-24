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

  test('Galaxy 세로 화면에서 순서 정하기 윷 연출을 낮추고 확정 순서 번호를 표시한다', async ({ page, context }, testInfo) => {
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

    const anchor = page.getByTestId('turn-order-roll-stage-anchor');
    const rollStage = anchor.locator(':scope > .roll-stage');
    const rollMat = page.getByTestId('roll-mat');
    await expect(rollStage).toBeVisible({ timeout: 5_000 });
    await expect(rollMat).toBeVisible();
    const layout = await anchor.evaluate((anchorElement) => {
      const boardPanel = anchorElement.parentElement;
      const board = boardPanel?.querySelector('[data-testid="game-board"]');
      const overlay = boardPanel?.querySelector('[data-testid="turn-order-overlay"]');
      const stage = anchorElement.querySelector(':scope > .roll-stage');
      const mat = stage?.querySelector('[data-testid="roll-mat"]');
      if (!(boardPanel instanceof HTMLElement)
        || !(board instanceof HTMLElement)
        || !(overlay instanceof HTMLElement)
        || !(stage instanceof HTMLElement)
        || !(mat instanceof HTMLElement)) {
        throw new Error('순서 정하기 윷 연출 위치 기준 요소를 찾지 못했습니다.');
      }
      const centerX = (rect) => rect.left + rect.width / 2;
      const centerY = (rect) => rect.top + rect.height / 2;
      const panelRect = boardPanel.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const anchorRect = anchorElement.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const matRect = mat.getBoundingClientRect();
      return {
        anchorOverlayCenterXOffset: Math.abs(centerX(anchorRect) - centerX(overlayRect)),
        anchorOverlayCenterYOffset: Math.abs(centerY(anchorRect) - centerY(overlayRect)),
        stageAnchorCenterXOffset: Math.abs(centerX(stageRect) - centerX(anchorRect)),
        matBoardCenterXOffset: Math.abs(centerX(matRect) - centerX(boardRect)),
        matTopFromBoardTop: matRect.top - boardRect.top,
        matTopFromPanelTop: matRect.top - panelRect.top,
        matBottomFromPanelBottom: matRect.bottom - panelRect.bottom,
      };
    });
    expect(layout.anchorOverlayCenterXOffset).toBeLessThanOrEqual(1);
    expect(layout.anchorOverlayCenterYOffset).toBeLessThanOrEqual(1);
    expect(layout.stageAnchorCenterXOffset).toBeLessThanOrEqual(1);
    expect(layout.matBoardCenterXOffset).toBeLessThanOrEqual(1);
    expect(layout.matTopFromBoardTop, '순서 정하기 윷 매트는 상단 게임 윷판보다 아래에서 표시되어야 합니다.').toBeGreaterThanOrEqual(24);
    expect(layout.matTopFromPanelTop).toBeGreaterThanOrEqual(0);
    expect(layout.matBottomFromPanelBottom).toBeLessThanOrEqual(48);

    await expect(page.getByTestId('turn-order-own-result')).toContainText('모');
    await expect(page.getByTestId('turn-order-spectating')).toBeVisible({ timeout: 25_000 });
    const ownCard = page.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: nickname });
    await expect(ownCard).toContainText('1번째');
    await expect(ownCard).toContainText('순서 확정');
    await expect(ownCard).not.toContainText('순위 확정');
  });
});
