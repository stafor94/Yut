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

        const cardBox = await roomCard.boundingBox();
        const contentBox = await roomCard.locator('.lobby-room-content').boundingBox();
        const mainBox = await roomCard.locator('.lobby-room-main').boundingBox();
        const sideBox = await roomCard.locator('.lobby-room-side').boundingBox();
        const titleBox = await roomCard.locator('.lobby-room-main > b').boundingBox();
        const metaBox = await roomCard.locator('.lobby-room-meta').boundingBox();
        const statusBox = await roomCard.locator('.lobby-room-status').boundingBox();
        const actionBox = await roomCard.locator('.lobby-room-action').boundingBox();
        const layoutStyles = await roomCard.evaluate((card) => {
          const content = card.querySelector('.lobby-room-content');
          const side = card.querySelector('.lobby-room-side');
          const status = card.querySelector('.lobby-room-status');
          const action = card.querySelector('.lobby-room-action');
          return {
            cardPaddingLeft: Number.parseFloat(getComputedStyle(card).paddingLeft),
            cardPaddingRight: Number.parseFloat(getComputedStyle(card).paddingRight),
            contentColumns: content ? getComputedStyle(content).gridTemplateColumns : '',
            sideWidth: side ? getComputedStyle(side).width : '',
            statusWidth: status ? getComputedStyle(status).width : '',
            actionWidth: action ? getComputedStyle(action).width : '',
          };
        });

        try {
          expect(cardBox, '카드 bounding box').not.toBeNull();
          expect(contentBox, '카드 content bounding box').not.toBeNull();
          expect(mainBox, '왼쪽 main column bounding box').not.toBeNull();
          expect(sideBox, '오른쪽 action column bounding box').not.toBeNull();
          expect(titleBox, '방 제목 bounding box').not.toBeNull();
          expect(metaBox, '옵션 배지 bounding box').not.toBeNull();
          expect(statusBox, '상태 배지 bounding box').not.toBeNull();
          expect(actionBox, '참여 버튼 bounding box').not.toBeNull();
          expect(layoutStyles.cardPaddingLeft, '카드 좌우 padding은 동일해야 합니다.').toBe(layoutStyles.cardPaddingRight);
          expect(layoutStyles.cardPaddingRight, '모바일 카드 오른쪽 padding은 20px이어야 합니다.').toBe(20);
          expect(layoutStyles.contentColumns, 'content grid는 오른쪽 76px action column을 가져야 합니다.').toContain('76px');
          expect(layoutStyles.sideWidth, 'side column 폭은 76px이어야 합니다.').toBe('76px');
          expect(layoutStyles.statusWidth, '대기중 배지는 side column 전체 폭을 사용해야 합니다.').toBe('76px');
          expect(layoutStyles.actionWidth, '참여 버튼은 side column 전체 폭을 사용해야 합니다.').toBe('76px');

          const cardInnerRight = cardBox.x + cardBox.width - layoutStyles.cardPaddingRight;
          expect(Math.abs((contentBox.x + contentBox.width) - cardInnerRight), 'content 오른쪽 끝은 카드 오른쪽 padding 안쪽 끝과 같아야 합니다.').toBeLessThanOrEqual(1);
          expect(Math.abs((sideBox.x + sideBox.width) - cardInnerRight), 'side column은 카드 오른쪽 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
          expect(Math.abs((statusBox.x + statusBox.width) - cardInnerRight), '대기중 배지는 카드 오른쪽 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
          expect(Math.abs((actionBox.x + actionBox.width) - cardInnerRight), '참여 버튼은 카드 오른쪽 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
          expect(mainBox.x + mainBox.width, 'main column은 side column과 겹치면 안 됩니다.').toBeLessThanOrEqual(sideBox.x);
          expect(boxesOverlap(titleBox, statusBox), '방 제목은 상태 배지와 겹치면 안 됩니다.').toBe(false);
          expect(boxesOverlap(titleBox, actionBox), '방 제목은 참여 버튼과 겹치면 안 됩니다.').toBe(false);
          expect(boxesOverlap(metaBox, statusBox), '옵션 배지는 상태 배지와 겹치면 안 됩니다.').toBe(false);
          expect(boxesOverlap(metaBox, actionBox), '옵션 배지는 참여 버튼과 겹치면 안 됩니다.').toBe(false);
        } catch (error) {
          await testInfo.attach('mobile-lobby-room-card-layout-failure', {
            body: await guestPage.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
          throw error;
        }
      } finally {
        await guestContext.close();
        await Promise.allSettled(roomIds.map((roomId) => deleteRoomForQa(roomId)));
      }
    });
  });
});
