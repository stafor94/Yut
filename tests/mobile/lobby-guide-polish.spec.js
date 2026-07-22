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
      const confirmButton = dialog.getByRole('button', { name: '확인' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.howto-list article')).toHaveCount(4);
      await expect(dialog.locator('.howto-result-strip span')).toHaveCount(6);
      await expect(confirmButton).toBeVisible();
      await expect(confirmButton).toBeInViewport();

      const layout = await dialog.evaluate((element) => {
        const cards = Array.from(element.querySelectorAll('.howto-list article'));
        const resultItems = Array.from(element.querySelectorAll('.howto-result-strip span'));
        const confirm = element.querySelector('.howto-confirm-button');
        const header = element.querySelector('.howto-fixed-header');
        const body = element.querySelector('.howto-scroll-body');
        const footer = element.querySelector('.howto-fixed-footer');
        const timingHeading = cards[1]?.querySelector('h4');
        const timingParagraphs = cards[1] ? Array.from(cards[1].querySelectorAll('p')) : [];
        const splitRuleParagraphs = cards[3] ? Array.from(cards[3].querySelectorAll('p')) : [];
        if (cards.length !== 4 || resultItems.length !== 6 || timingParagraphs.length < 2 || splitRuleParagraphs.length !== 2 || !(timingHeading instanceof HTMLElement) || !(confirm instanceof HTMLElement) || !(header instanceof HTMLElement) || !(body instanceof HTMLElement) || !(footer instanceof HTMLElement)) return null;
        const rect = (target) => {
          const box = target.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const dialogRect = element.getBoundingClientRect();
        const cardRects = cards.map(rect);
        const resultRects = resultItems.map(rect);
        const splitRuleRects = splitRuleParagraphs.map(rect);
        const splitRuleLabels = splitRuleParagraphs.map((paragraph) => getComputedStyle(paragraph, '::before').content);
        const timingHeadingContent = getComputedStyle(timingHeading, '::after').content;
        const timingParagraphContents = timingParagraphs.slice(0, 2).map((paragraph) => getComputedStyle(paragraph, '::after').content);
        const confirmRect = rect(confirm);
        const footerStyle = getComputedStyle(footer);
        body.scrollTop = 42;
        const changedScrollTop = body.scrollTop;
        body.scrollTop = body.scrollHeight;
        const last = element.querySelector('.howto-section:last-of-type');
        const yutBonus = getComputedStyle(resultItems[4], '::after');
        const moBonus = getComputedStyle(resultItems[5], '::after');
        return {
          documentCharset: document.characterSet,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentScrollWidth: document.documentElement.scrollWidth,
          dialog: rect(element),
          overflowY: getComputedStyle(element).overflowY,
          bodyOverflowY: getComputedStyle(body).overflowY,
          bodyScrollHeight: body.scrollHeight,
          bodyClientHeight: body.clientHeight,
          changedScrollTop,
          lastContentBottom: last?.getBoundingClientRect().bottom ?? 0,
          bodyBottom: body.getBoundingClientRect().bottom,
          header: rect(header),
          footer: rect(footer),
          footerBackgroundImage: footerStyle.backgroundImage,
          footerBoxShadow: footerStyle.boxShadow,
          footerBorderTopWidth: Number.parseFloat(footerStyle.borderTopWidth),
          cardRects,
          resultRects,
          timingHeadingContent,
          timingParagraphContents,
          splitRuleRects,
          splitRuleLabels,
          confirm: confirmRect,
          confirmPosition: getComputedStyle(confirm).position,
          yutBonusContent: yutBonus.content,
          moBonusContent: moBonus.content,
          dialogHeight: dialogRect.height,
          dialogCenterOffset: Math.abs((dialogRect.top + dialogRect.bottom) / 2 - window.innerHeight / 2),
        };
      });

      expect(layout, '모바일 게임 방법 팝업 레이아웃을 읽을 수 있어야 합니다.').not.toBeNull();
      expect(layout.documentCharset, 'HTML과 CSS 한글은 UTF-8로 해석되어야 합니다.').toBe('UTF-8');
      expect(layout.documentScrollWidth, '팝업이 가로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.dialog.x, '팝업 왼쪽이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.dialog.right, '팝업 오른쪽이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.dialog.y, '팝업 상단이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.dialog.bottom, '팝업 하단이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(layout.dialogHeight, '게임 방법 팝업 높이는 화면의 약 70%여야 합니다.').toBeGreaterThanOrEqual(layout.viewportHeight * 0.68);
      expect(layout.dialogHeight, '게임 방법 팝업 높이는 화면의 약 70%여야 합니다.').toBeLessThanOrEqual(layout.viewportHeight * 0.72);
      expect(layout.dialogCenterOffset, '게임 방법 팝업은 화면 중앙에 배치되어야 합니다.').toBeLessThanOrEqual(2);
      expect(layout.overflowY, '팝업 전체가 스크롤 컨테이너가 되면 안 됩니다.').toBe('hidden');
      expect(layout.bodyOverflowY, '중앙 영역에서만 스크롤할 수 있어야 합니다.').toBe('auto');
      expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);
      expect(layout.changedScrollTop).toBeGreaterThan(0);
      expect(layout.lastContentBottom).toBeLessThanOrEqual(layout.bodyBottom + 1);
      expect(Math.abs(layout.cardRects[0].y - layout.cardRects[1].y), '첫 두 단계는 같은 행에서 비교할 수 있어야 합니다.').toBeLessThanOrEqual(1);
      expect(layout.cardRects[2].y, '두 번째 카드 행은 첫 번째 행 아래에 있어야 합니다.').toBeGreaterThan(layout.cardRects[0].y);
      expect(layout.cardRects[3].y, '빽도와 완주 구획은 말 이동 규칙 아래의 독립 행이어야 합니다.').toBeGreaterThan(layout.cardRects[2].y);
      layout.cardRects.forEach((card) => {
        expect(card.x, '설명 카드가 팝업 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.dialog.x);
        expect(card.right, '설명 카드가 팝업 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.dialog.right + 1);
      });
      expect(layout.timingHeadingContent).toContain('윷 던지기와 타이밍');
      expect(layout.timingParagraphContents[0]).toContain('Perfect');
      expect(layout.timingParagraphContents[0]).toContain('Nice');
      expect(layout.timingParagraphContents[0]).toContain('Good');
      expect(layout.timingParagraphContents[0]).toContain('Bad');
      expect(layout.timingParagraphContents[0]).toContain('45~55%');
      expect(layout.timingParagraphContents[1]).toContain('10%·20%·60%');
      expect(layout.splitRuleLabels[0]).toContain('빽도');
      expect(layout.splitRuleLabels[1]).toContain('완주');
      expect(Math.abs(layout.splitRuleRects[0].y - layout.splitRuleRects[1].y), '빽도와 완주는 별도 카드로 같은 행에 구획되어야 합니다.').toBeLessThanOrEqual(1);
      expect(layout.splitRuleRects[1].x, '완주 구획은 빽도 구획 오른쪽에 분리되어야 합니다.').toBeGreaterThan(layout.splitRuleRects[0].right);
      expect(layout.footerBackgroundImage, '확인 버튼 주위에 별도 사각 배경이 없어야 합니다.').toBe('none');
      expect(layout.footerBoxShadow, '확인 버튼 주위에 별도 그림자가 없어야 합니다.').toBe('none');
      expect(layout.footerBorderTopWidth, '확인 버튼 주위에 별도 경계선이 없어야 합니다.').toBe(0);
      expect(layout.confirmPosition, '확인 버튼은 footer 안에서 접근 가능해야 합니다.').toBe('static');
      expect(layout.confirm.bottom, '확인 버튼은 처음부터 화면 안에 보여야 합니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(layout.yutBonusContent).toContain('한 번 더');
      expect(layout.moBonusContent).toContain('한 번 더');
    });
  });
});
