import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { startGameStatisticsQaGame } from '../helpers/game-statistics-game.js';

test.describe('통계 정보 팝업 Galaxy Mobile QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('412x915에서 플레이어 탭만 가로 스크롤되고 기록·하단 통계가 화면 안에 유지된다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    const started = await startGameStatisticsQaGame(page, context, testInfo, { playerCount: 4 });
    roomId = started.roomId;

    await page.getByTestId('game-statistics-button').click();
    const dialog = page.getByTestId('game-statistics-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab')).toHaveCount(4);
    await expect(dialog.locator('.game-statistics-record')).toHaveCount(1, { timeout: 15_000 });

    const layout = await dialog.evaluate((element) => {
      const tabs = element.querySelector('.game-statistics-tabs');
      const records = element.querySelector('.game-statistics-records');
      const footer = element.querySelector('.game-statistics-footer');
      const closeButton = footer?.querySelector('button');
      if (!(tabs instanceof HTMLElement) || !(records instanceof HTMLElement) || !(footer instanceof HTMLElement) || !(closeButton instanceof HTMLElement)) {
        throw new Error('통계 팝업 모바일 레이아웃 요소를 찾지 못했습니다.');
      }
      const dialogBox = element.getBoundingClientRect();
      const tabsBox = tabs.getBoundingClientRect();
      const recordsBox = records.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      const closeBox = closeButton.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        dialog: { left: dialogBox.left, right: dialogBox.right, top: dialogBox.top, bottom: dialogBox.bottom },
        tabsOverflowX: getComputedStyle(tabs).overflowX,
        tabsScrollWidth: tabs.scrollWidth,
        tabsClientWidth: tabs.clientWidth,
        tabs: { left: tabsBox.left, right: tabsBox.right },
        recordsOverflowY: getComputedStyle(records).overflowY,
        recordsHeight: recordsBox.height,
        records: { left: recordsBox.left, right: recordsBox.right, top: recordsBox.top, bottom: recordsBox.bottom },
        footer: { top: footerBox.top, bottom: footerBox.bottom },
        close: { top: closeBox.top, bottom: closeBox.bottom },
      };
    });

    expect(layout.dialog.left).toBeGreaterThanOrEqual(0);
    expect(layout.dialog.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.dialog.top).toBeGreaterThanOrEqual(0);
    expect(layout.dialog.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.tabsOverflowX).toBe('auto');
    expect(layout.tabsScrollWidth).toBeGreaterThan(layout.tabsClientWidth);
    expect(layout.tabs.left).toBeGreaterThanOrEqual(layout.dialog.left);
    expect(layout.tabs.right).toBeLessThanOrEqual(layout.dialog.right);
    expect(layout.recordsOverflowY).toBe('auto');
    expect(layout.recordsHeight).toBeGreaterThan(120);
    expect(layout.records.left).toBeGreaterThanOrEqual(layout.dialog.left);
    expect(layout.records.right).toBeLessThanOrEqual(layout.dialog.right);
    expect(layout.records.bottom).toBeLessThanOrEqual(layout.footer.top);
    expect(layout.close.bottom).toBeLessThanOrEqual(layout.viewportHeight);

    const lastTab = dialog.getByRole('tab').last();
    await lastTab.click();
    await expect(lastTab).toHaveAttribute('aria-selected', 'true');
    await lastTab.evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await expect(dialog.locator('.game-statistics-state.empty')).toContainText('윷 던지기 기록이 없습니다.');
    await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  });
});
