import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('mobile lobby guide polish QA', () => {
  test('게임 방법 팝업은 세로 화면에서 카드와 확인 버튼을 함께 보여준다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '방법안내QA' });

    await runQaStep(testInfo, '모바일 게임 방법 팝업 구성 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);
      await page.getByRole('button', { name: '게임 방법', exact: true }).click();

      const dialog = page.getByRole('dialog', { name: '게임 방법' });
      const confirmButton = dialog.getByRole('button', { name: '확인하고 시작하기' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.howto-list article')).toHaveCount(4);
      await expect(dialog.locator('.howto-result-strip span')).toHaveCount(5);
      await expect(confirmButton).toBeVisible();
      await expect(confirmButton).toBeInViewport();

      const layout = await dialog.evaluate((element) => {
        const cards = Array.from(element.querySelectorAll('.howto-list article'));
        const resultItems = Array.from(element.querySelectorAll('.howto-result-strip span'));
        const confirm = element.querySelector('.howto-confirm-button');
        if (cards.length !== 4 || resultItems.length !== 5 || !(confirm instanceof HTMLElement)) return null;
        const rect = (target) => {
          const box = target.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const dialogRect = element.getBoundingClientRect();
        const cardRects = cards.map(rect);
        const resultRects = resultItems.map(rect);
        const confirmRect = rect(confirm);
        const yutBonus = getComputedStyle(resultItems[3], '::after');
        const moBonus = getComputedStyle(resultItems[4], '::after');
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentScrollWidth: document.documentElement.scrollWidth,
          dialog: rect(element),
          overflowY: getComputedStyle(element).overflowY,
          cardRects,
          resultRects,
          confirm: confirmRect,
          confirmPosition: getComputedStyle(confirm).position,
          yutBonusContent: yutBonus.content,
          moBonusContent: moBonus.content,
          dialogHeight: dialogRect.height,
        };
      });

      expect(layout, '모바일 게임 방법 팝업 레이아웃을 읽을 수 있어야 합니다.').not.toBeNull();
      expect(layout.documentScrollWidth, '팝업이 가로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.dialog.x, '팝업 왼쪽이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.dialog.right, '팝업 오른쪽이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.dialog.y, '팝업 상단이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.dialog.bottom, '팝업 하단이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(layout.dialogHeight, '게임 방법 팝업이 화면 전체를 과도하게 덮으면 안 됩니다.').toBeLessThanOrEqual(layout.viewportHeight - 12);
      expect(layout.overflowY, '내용이 넘치면 팝업 내부에서 스크롤할 수 있어야 합니다.').toBe('auto');
      expect(Math.abs(layout.cardRects[0].y - layout.cardRects[1].y), '첫 두 단계는 같은 행에서 비교할 수 있어야 합니다.').toBeLessThanOrEqual(1);
      expect(Math.abs(layout.cardRects[2].y - layout.cardRects[3].y), '다음 두 단계도 같은 행에 있어야 합니다.').toBeLessThanOrEqual(1);
      expect(layout.cardRects[2].y, '두 번째 카드 행은 첫 번째 행 아래에 있어야 합니다.').toBeGreaterThan(layout.cardRects[0].y);
      layout.cardRects.forEach((card) => {
        expect(card.x, '설명 카드가 팝업 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.dialog.x);
        expect(card.right, '설명 카드가 팝업 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.dialog.right + 1);
      });
      expect(layout.confirmPosition, '확인 버튼은 스크롤 중에도 하단에 유지되어야 합니다.').toBe('sticky');
      expect(layout.confirm.bottom, '확인 버튼은 처음부터 화면 안에 보여야 합니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(layout.yutBonusContent).toContain('한 번 더');
      expect(layout.moBonusContent).toContain('한 번 더');
    });
  });
});
