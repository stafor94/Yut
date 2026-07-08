import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe('mobile layout QA', () => {
  test('모바일/태블릿 뷰포트에서 로비 핵심 탭 대상이 보인다', async ({ page }, testInfo) => {
    await runQaStep(testInfo, '모바일 로비 핵심 UI 확인', async () => {
      await expectAppShell(page);
      await expect(page.getByTestId('room-title-input')).toBeVisible();
      await expect(page.getByTestId('create-room-button')).toBeVisible();
      await expect(page.getByTestId('create-room-button')).toBeEnabled();
    });
  });

  test('모바일 로비 방 카드의 좌우 영역이 겹치지 않는다', async ({ page, context, browser }, testInfo) => {
    const hostNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-card-host'));
    const guestNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-card-guest'));
    const roomTitle = `${makeQaName(testInfo, 'mobile-card-room')}-긴-방-제목-겹침-검증`;
    const roomIds = [];
    await primeLobbyStorage(context, { nickname: hostNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'true', pieceCount: '5' });

    await runQaStep(testInfo, '모바일 로비 방 카드 boundingBox 겹침 확인', async () => {
      const guestContext = await browser.newContext({
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        userAgent: testInfo.project.use.userAgent,
      });
      await primeLobbyStorage(guestContext, { nickname: guestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'true', pieceCount: '5' });

      try {
        await expectAppShell(page);
        await page.getByTestId('room-title-input').fill(roomTitle);
        await page.getByTestId('create-room-button').click();
        await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
        const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
        if (roomId) roomIds.push(roomId);

        const guestPage = await guestContext.newPage();
        await expectAppShell(guestPage);
        await waitForBlockingOverlayToDisappear(guestPage);
        const roomCard = guestPage.locator('.lobby-room-card').filter({ hasText: roomTitle }).first();
        await expect(roomCard).toBeVisible({ timeout: 20_000 });

        const titleBox = await roomCard.locator('.lobby-room-main > b').boundingBox();
        const metaBox = await roomCard.locator('.lobby-room-meta').boundingBox();
        const statusBox = await roomCard.locator('.lobby-room-status').boundingBox();
        const actionBox = await roomCard.locator('.lobby-room-action').boundingBox();
        expect(titleBox, '방 제목 bounding box').not.toBeNull();
        expect(metaBox, '옵션 배지 bounding box').not.toBeNull();
        expect(statusBox, '상태 배지 bounding box').not.toBeNull();
        expect(actionBox, '참여 버튼 bounding box').not.toBeNull();
        expect(boxesOverlap(titleBox, statusBox), '방 제목은 상태 배지와 겹치면 안 됩니다.').toBe(false);
        expect(boxesOverlap(titleBox, actionBox), '방 제목은 참여 버튼과 겹치면 안 됩니다.').toBe(false);
        expect(boxesOverlap(metaBox, statusBox), '옵션 배지는 상태 배지와 겹치면 안 됩니다.').toBe(false);
        expect(boxesOverlap(metaBox, actionBox), '옵션 배지는 참여 버튼과 겹치면 안 됩니다.').toBe(false);
      } finally {
        await guestContext.close();
        await Promise.allSettled(roomIds.map((roomId) => deleteRoomForQa(roomId)));
      }
    });
  });
});
