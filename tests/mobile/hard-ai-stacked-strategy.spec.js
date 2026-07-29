import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { attachConsoleErrorCapture, expectNoBlockingConsoleErrors } from '../helpers/ui.js';
import {
  prepareHardAiStackedStrategyFixture,
  waitForHardAiStackedStrategy,
} from '../helpers/hard-ai-stacked-strategy.js';

test.describe('Galaxy 어려움 AI 누적 이동 전략', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(150_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('412×915에서 개→n06, 도→shortcut authoritative sequence 후 화면이 계속 진행된다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });
    const fixture = await prepareHardAiStackedStrategyFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const result = await waitForHardAiStackedStrategy(fixture);

    expect(result.firstMove.action?.payload?.roll?.name).toBe('개');
    expect(result.secondMove.action?.payload?.roll?.name).toBe('도');
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(async () => {
      const gameVisible = await page.getByTestId('game-screen').isVisible().catch(() => false);
      const controlsVisible = await page.getByTestId('play-controls').isVisible().catch(() => false);
      const pickerCount = await page.locator('.roll-stack-picker button').count();
      return gameVisible && controlsVisible && pickerCount === 0;
    }, {
      timeout: 8_000,
      intervals: [100, 200, 400],
      message: 'Galaxy 화면이 hard AI 누적 이동 상태에 고착되지 않아야 합니다.',
    }).toBe(true);
    expect(page.url()).toContain('/Yut/');
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
