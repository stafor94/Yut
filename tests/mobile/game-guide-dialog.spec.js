import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  baseStatisticsSeats,
  baseStatisticsSequences,
  installGameStatisticsFixture,
} from '../helpers/game-statistics-fixture.js';

test('412×915에서 P2 게임 방법 팝업이 로비 규격과 내부 스크롤을 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await expectAppShell(page);
  await installGameStatisticsFixture(page, {
    seats: baseStatisticsSeats,
    sequences: baseStatisticsSequences,
    localSeatId: 'p2',
    showSequenceExport: false,
    includeGameGuide: true,
  });

  await expect(page.getByRole('button', { name: '최신 상태와 전체 시퀀스 내보내기' })).toHaveCount(0);
  const guideButton = page.getByRole('button', { name: '게임 방법 열기' });
  const buttonVisual = await guideButton.evaluate((button) => {
    const style = getComputedStyle(button);
    return { backgroundImage: style.backgroundImage, color: style.color, boxShadow: style.boxShadow };
  });
  expect(buttonVisual.backgroundImage).toContain('linear-gradient');
  expect(buttonVisual.color).not.toBe('rgb(122, 74, 38)');
  expect(buttonVisual.boxShadow).not.toBe('none');
  await guideButton.click();
  const dialog = page.getByTestId('game-guide-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.howto-list article')).toHaveCount(4);
  const resultItems = dialog.locator('.howto-result-strip > span');
  await expect(resultItems).toHaveCount(6);
  expect((await resultItems.allTextContents()).map((text) => text.replace(/\s/g, ''))).toEqual([
    '빽도-1칸6.25%',
    '도1칸18.75%',
    '개2칸37.5%',
    '걸3칸25%',
    '윷4칸6.25%',
    '모5칸6.25%',
  ]);
  await expect(dialog.locator('.howto-result-probabilities')).toHaveCount(0);
  await expect(dialog.locator('.howto-results-section')).not.toContainText(/Perfect|Nice/);

  const layout = await dialog.evaluate((element) => {
    const body = element.querySelector('.howto-scroll-body');
    const confirm = element.querySelector('.howto-confirm-button');
    const probabilities = Array.from(element.querySelectorAll('.howto-result-probability'));
    if (!(body instanceof HTMLElement) || !(confirm instanceof HTMLElement) || probabilities.length !== 6) throw new Error('게임 방법 팝업 구조를 찾지 못했습니다.');
    const box = element.getBoundingClientRect();
    const confirmBox = confirm.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyScrollable: body.scrollHeight > body.clientHeight,
      probabilitiesVisible: probabilities.every((probability) => {
        const style = getComputedStyle(probability);
        return style.display !== 'none' && Number.parseFloat(style.fontSize) > 0;
      }),
      confirmTop: confirmBox.top,
      confirmBottom: confirmBox.bottom,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyOverflowY).toMatch(/auto|scroll/);
  expect(layout.bodyScrollable).toBe(true);
  expect(layout.probabilitiesVisible).toBe(true);
  expect(layout.confirmTop).toBeGreaterThan(layout.top);
  expect(layout.confirmBottom).toBeLessThanOrEqual(layout.bottom);
});
