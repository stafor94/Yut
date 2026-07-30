import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  baseStatisticsSeats,
  baseStatisticsSequences,
  installGameStatisticsFixture,
} from '../helpers/game-statistics-fixture.js';

const STANDARD_RESULT_PROBABILITIES = ['6.25%', '18.75%', '37.5%', '25%', '6.25%', '6.25%'];

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
    const icon = button.querySelector('svg');
    const buttonStyle = getComputedStyle(button);
    return {
      backgroundImage: buttonStyle.backgroundImage,
      iconStroke: icon ? getComputedStyle(icon).stroke : '',
    };
  });
  expect(buttonVisual.backgroundImage, '모바일에서도 게임 방법 버튼은 진행 기록 패널과 구분되어야 합니다.').toContain('linear-gradient');
  expect(buttonVisual.iconStroke).toBe('rgb(255, 253, 241)');
  await guideButton.click();
  const dialog = page.getByTestId('game-guide-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.howto-list article')).toHaveCount(4);
  await expect(dialog.locator('.howto-result-strip span')).toHaveCount(6);

  const layout = await dialog.evaluate((element) => {
    const body = element.querySelector('.howto-scroll-body');
    const confirm = element.querySelector('.howto-confirm-button');
    const summary = element.querySelector('.howto-result-probabilities');
    const resultItems = Array.from(element.querySelectorAll('.howto-result-strip span'));
    if (!(body instanceof HTMLElement) || !(confirm instanceof HTMLElement) || !(summary instanceof HTMLElement) || resultItems.length !== 6) throw new Error('게임 방법 팝업 구조를 찾지 못했습니다.');
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
      confirmTop: confirmBox.top,
      confirmBottom: confirmBox.bottom,
      documentScrollWidth: document.documentElement.scrollWidth,
      summaryDisplay: getComputedStyle(summary).display,
      probabilities: resultItems.map((item) => getComputedStyle(item, '::before').content.replace(/^["']|["']$/g, '')),
    };
  });

  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyOverflowY).toMatch(/auto|scroll/);
  expect(layout.bodyScrollable).toBe(true);
  expect(layout.confirmTop).toBeGreaterThan(layout.top);
  expect(layout.confirmBottom).toBeLessThanOrEqual(layout.bottom);
  expect(layout.summaryDisplay).toBe('none');
  expect(layout.probabilities).toEqual(STANDARD_RESULT_PROBABILITIES);
  expect(await dialog.locator('.howto-results-section').innerText()).not.toMatch(/Perfect|Nice|Good|Bad/);
});
