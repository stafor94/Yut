import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { createLobbyRoomFixtureForQa, deleteRoomForQa } from '../helpers/rooms.js';

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

  test('닉네임 팝업이 목재 프레임 안에서 모바일 화면을 벗어나지 않는다', async ({ page }, testInfo) => {
    await runQaStep(testInfo, '모바일 공통 팝업 스타일 확인', async () => {
      await expectAppShell(page);
      await page.locator('.nickname-chip').click();

      const backdrop = page.locator('.nickname-dialog-backdrop');
      const modal = backdrop.locator('.nickname-modal');
      await expect(backdrop).toBeVisible();
      await expect(modal).toBeVisible();

      const layout = await modal.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          borderWidth: Number.parseFloat(style.borderTopWidth),
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
        };
      });

      expect(layout.borderWidth, '공통 팝업은 두꺼운 목재 프레임을 사용해야 합니다.').toBeGreaterThanOrEqual(5);
      expect(layout.backgroundImage, '공통 팝업은 목재/한지 그라데이션 표면을 사용해야 합니다.').toContain('gradient');
      expect(layout.boxShadow, '공통 팝업은 입체 프레임 그림자를 사용해야 합니다.').not.toBe('none');
      expect(layout.rect.x, '팝업 왼쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.rect.y, '팝업 위쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.rect.x + layout.rect.width, '팝업 오른쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.rect.y + layout.rect.height, '팝업 아래쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.height);

      await page.getByRole('button', { name: '취소' }).click();
      await expect(backdrop).toBeHidden();
    });
  });

  test('모바일 로비 방 카드의 좌우 영역이 겹치지 않는다', async ({ page, context }, testInfo) => {
    const hostNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-card-host'));
    const guestNickname = normalizeQaNickname(makeQaName(testInfo, 'mobile-card-guest'));
    const roomTitle = `${makeQaName(testInfo, 'mobile-card-room')}-긴-방-제목-겹침-검증`;
    let roomId;
    await primeLobbyStorage(context, { nickname: guestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'true', pieceCount: '5' });

    await runQaStep(testInfo, '모바일 로비 방 카드 boundingBox 겹침 확인', async () => {
      try {
        roomId = await createLobbyRoomFixtureForQa({
          title: roomTitle,
          hostNickname,
          maxPlayers: 2,
          playMode: 'individual',
          itemMode: true,
          stackedRollMode: false,
          pieceCount: 4,
        });

        await expectAppShell(page);
        await waitForBlockingOverlayToDisappear(page);
        const roomCard = page.locator('.lobby-room-card').filter({ hasText: roomTitle }).first();
        await expect(roomCard).toBeVisible({ timeout: 20_000 });

        try {
          await expect(async () => {
            const layout = await roomCard.evaluate((card) => {
              const main = card.querySelector('.lobby-room-main');
              const side = card.querySelector('.lobby-room-side');
              const title = card.querySelector('.lobby-room-main > b');
              const meta = card.querySelector('.lobby-room-meta');
              const status = card.querySelector('.lobby-room-status');
              const action = card.querySelector('.lobby-room-action');
              const content = card.querySelector('.lobby-room-content');
              const toBox = (element) => {
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return null;
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
              };

              return {
                cardBox: toBox(card),
                mainBox: toBox(main),
                sideBox: toBox(side),
                titleBox: toBox(title),
                metaBox: toBox(meta),
                statusBox: toBox(status),
                actionBox: toBox(action),
                styles: {
                  cardPaddingLeft: Number.parseFloat(getComputedStyle(card).paddingLeft),
                  cardPaddingRight: Number.parseFloat(getComputedStyle(card).paddingRight),
                  cardColumns: getComputedStyle(card).gridTemplateColumns,
                  contentDisplay: content ? getComputedStyle(content).display : '',
                  sideWidth: side ? getComputedStyle(side).width : '',
                  statusWidth: status ? getComputedStyle(status).width : '',
                  actionWidth: action ? getComputedStyle(action).width : '',
                },
              };
            });

            const { cardBox, mainBox, sideBox, titleBox, metaBox, statusBox, actionBox, styles } = layout;
            expect(cardBox, '카드 bounding box').not.toBeNull();
            expect(mainBox, '왼쪽 main column bounding box').not.toBeNull();
            expect(sideBox, '오른쪽 action column bounding box').not.toBeNull();
            expect(titleBox, '방 제목 bounding box').not.toBeNull();
            expect(metaBox, '옵션 배지 bounding box').not.toBeNull();
            expect(statusBox, '상태 배지 bounding box').not.toBeNull();
            expect(actionBox, '참여 버튼 bounding box').not.toBeNull();
            expect(styles.cardPaddingLeft, '카드 좌우 padding은 동일해야 합니다.').toBe(styles.cardPaddingRight);
            expect(styles.cardPaddingRight, '모바일 카드 오른쪽 padding은 20px이어야 합니다.').toBe(20);
            expect(styles.cardColumns, 'card grid는 오른쪽 76px action column을 가져야 합니다.').toContain('76px');
            expect(styles.contentDisplay, 'content wrapper는 card grid 배치를 위해 contents로 풀려야 합니다.').toBe('contents');
            expect(styles.sideWidth, 'side column 폭은 76px이어야 합니다.').toBe('76px');
            expect(styles.statusWidth, '대기중 배지는 side column 전체 폭을 사용해야 합니다.').toBe('76px');
            expect(styles.actionWidth, '참여 버튼은 side column 전체 폭을 사용해야 합니다.').toBe('76px');

            const cardInnerRight = cardBox.x + cardBox.width - styles.cardPaddingRight;
            expect(Math.abs((sideBox.x + sideBox.width) - cardInnerRight), 'side column은 카드 오른쪽 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
            expect(Math.abs((statusBox.x + statusBox.width) - cardInnerRight), '대기중 배지는 카드 오른쪽 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
            expect(Math.abs((actionBox.x + actionBox.width) - cardInnerRight), '참여 버튼은 카드 오른쪽 padding 안쪽 끝에 붙어야 합니다.').toBeLessThanOrEqual(1);
            expect(mainBox.x + mainBox.width, 'main column은 side column과 겹치면 안 됩니다.').toBeLessThanOrEqual(sideBox.x);
            expect(boxesOverlap(titleBox, statusBox), '방 제목은 상태 배지와 겹치면 안 됩니다.').toBe(false);
            expect(boxesOverlap(titleBox, actionBox), '방 제목은 참여 버튼과 겹치면 안 됩니다.').toBe(false);
            expect(boxesOverlap(metaBox, statusBox), '옵션 배지는 상태 배지와 겹치면 안 됩니다.').toBe(false);
            expect(boxesOverlap(metaBox, actionBox), '옵션 배지는 참여 버튼과 겹치면 안 됩니다.').toBe(false);
          }).toPass({ timeout: 20_000, intervals: [100, 250, 500] });
        } catch (error) {
          await testInfo.attach('mobile-lobby-room-card-layout-failure', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
          throw error;
        }
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});
