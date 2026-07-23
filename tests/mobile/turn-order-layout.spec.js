import { test, expect } from '@playwright/test';
import { createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const readOverlayLayout = (overlay) => overlay.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const grid = element.querySelector('[data-testid="turn-order-result-grid"]');
  const gridStyle = grid ? getComputedStyle(grid) : null;
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyScrollWidth: document.documentElement.scrollWidth,
    gridColumns: gridStyle?.gridTemplateColumns ?? '',
  };
});

test.describe('turn-order mobile layout QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('Galaxy와 iPad에서 준비·타이밍·결과 UI가 중앙 프레임을 벗어나지 않는다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'turn-order-mobile'));
    const roomTitle = makeQaName(testInfo, 'turn-order-mobile-room');
    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    });

    await runQaStep(testInfo, '순서 정하기 오버레이 모바일 경계 확인', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await page.getByTestId('add-ai-P2').click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

      const overlay = page.getByTestId('turn-order-overlay');
      await expect(overlay).toBeVisible();
      await expect(page.getByTestId('turn-order-preparing')).toBeVisible({ timeout: 5_000 });
      let layout = await readOverlayLayout(overlay);
      expect(layout.rect.x).toBeGreaterThanOrEqual(0);
      expect(layout.rect.y).toBeGreaterThanOrEqual(0);
      expect(layout.rect.x + layout.rect.width).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.rect.y + layout.rect.height).toBeLessThanOrEqual(layout.viewport.height + 1);
      expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);

      const rollButton = page.getByTestId('turn-order-roll-button');
      await expect(rollButton).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('turn-order-timing-panel')).toBeVisible();
      await rollButton.click();
      await expect(page.getByTestId('turn-order-own-result')).toContainText('모');
      await expect(page.getByTestId('turn-order-result-grid')).toBeVisible();

      layout = await readOverlayLayout(overlay);
      expect(layout.gridColumns.split(' ').filter(Boolean).length).toBe(2);
      expect(layout.rect.x).toBeGreaterThanOrEqual(0);
      expect(layout.rect.y).toBeGreaterThanOrEqual(0);
      expect(layout.rect.x + layout.rect.width).toBeLessThanOrEqual(layout.viewport.width + 1);
      expect(layout.rect.y + layout.rect.height).toBeLessThanOrEqual(layout.viewport.height + 1);
      expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
    });
  });
});
