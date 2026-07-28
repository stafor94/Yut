import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import { installGameStatisticsFixture } from '../helpers/game-statistics-fixture.js';

test('412×915에서 탭만 가로 스크롤되고 기록만 세로 스크롤되며 하단 통계가 고정된다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await expectAppShell(page);

  const seats = [
    { id: 'p1', label: 'P1', name: '플레이어하나', color: 'red', team: '청팀', seatIndex: 0 },
    { id: 'p2', label: 'P2', name: '플레이어둘', color: 'blue', team: '홍팀', seatIndex: 1 },
    { id: 'p3', label: 'P3', name: '플레이어셋', color: 'green', team: '청팀', seatIndex: 2 },
    { id: 'ai-4', label: 'P4', name: 'AI 플레이어넷', color: 'yellow', team: '홍팀', seatIndex: 3, isAI: true },
  ];
  const results = ['빽도', '도', '개', '걸', '윷', '모'];
  const timings = ['perfect', 'nice', 'good', 'bad'];
  const sequences = Array.from({ length: 28 }, (_, index) => ({
    id: `mobile-roll-${index + 1}`,
    sequence: index + 1,
    type: 'roll_yut',
    actorId: 'p1',
    payload: {
      timingZone: timings[index % timings.length],
      displayRoll: { name: results[index % results.length], steps: (index % results.length) - 1 },
      fallOccurred: index === 5,
    },
  }));

  await installGameStatisticsFixture(page, {
    seats,
    sequences,
    localSeatId: 'p1',
    delayMs: 10,
  });
  await page.getByRole('button', { name: '통계 정보 열기' }).click();

  const dialog = page.getByTestId('game-statistics-dialog');
  const tabs = dialog.getByRole('tablist', { name: '플레이어 통계' });
  const records = dialog.getByTestId('game-statistics-records');
  const footer = dialog.getByTestId('game-statistics-footer');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: '플레이어하나' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();

  const layout = await page.evaluate(() => {
    const dialogElement = document.querySelector('[data-testid="game-statistics-dialog"]');
    const tabsElement = dialogElement?.querySelector('[role="tablist"]');
    const recordsElement = dialogElement?.querySelector('[data-testid="game-statistics-records"]');
    const footerElement = dialogElement?.querySelector('[data-testid="game-statistics-footer"]');
    if (!(dialogElement instanceof HTMLElement) || !(tabsElement instanceof HTMLElement) || !(recordsElement instanceof HTMLElement) || !(footerElement instanceof HTMLElement)) {
      throw new Error('통계 정보 모바일 레이아웃을 찾지 못했습니다.');
    }
    const dialogBox = dialogElement.getBoundingClientRect();
    const footerBox = footerElement.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogLeft: dialogBox.left,
      dialogTop: dialogBox.top,
      dialogRight: dialogBox.right,
      dialogBottom: dialogBox.bottom,
      dialogScrollWidth: dialogElement.scrollWidth,
      dialogClientWidth: dialogElement.clientWidth,
      tabScrollWidth: tabsElement.scrollWidth,
      tabClientWidth: tabsElement.clientWidth,
      recordScrollHeight: recordsElement.scrollHeight,
      recordClientHeight: recordsElement.clientHeight,
      footerTop: footerBox.top,
      footerBottom: footerBox.bottom,
    };
  });

  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogTop).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogScrollWidth).toBeLessThanOrEqual(layout.dialogClientWidth + 1);
  expect(layout.tabScrollWidth).toBeGreaterThan(layout.tabClientWidth);
  expect(layout.recordScrollHeight).toBeGreaterThan(layout.recordClientHeight);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.dialogBottom);

  const footerBeforeScroll = await footer.boundingBox();
  await records.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByTestId('game-statistics-record').last()).toBeInViewport();
  const footerAfterScroll = await footer.boundingBox();
  expect(Math.abs((footerAfterScroll?.y ?? 0) - (footerBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  await expect(tabs).toBeVisible();
});
