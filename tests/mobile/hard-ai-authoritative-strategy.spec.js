import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { attachConsoleErrorCapture, expectNoBlockingConsoleErrors } from '../helpers/ui.js';
import {
  prepareHardAiAuthoritativeFixture,
  waitForHardAiAuthoritativeStrategy,
} from '../helpers/hard-ai-authoritative-strategy.js';

test.describe('Galaxy 어려움 AI authoritative 누적 이동 전략', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(150_000);
  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('412×915에서 개→n06, 도→shortcut sequence 후 화면이 계속 진행된다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });
    const fixture = await prepareHardAiAuthoritativeFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const result = await waitForHardAiAuthoritativeStrategy(fixture);
    expect(result.firstMove.action?.payload?.rollStackIndex).toBe(1);
    expect(result.secondMove.action?.payload?.rollStackIndex).toBe(0);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(async () => (
      await page.getByTestId('game-screen').isVisible().catch(() => false)
      && await page.getByTestId('play-controls').isVisible().catch(() => false)
      && await page.locator('.roll-stack-picker button').count() === 0
    ), { timeout: 8_000 }).toBe(true);
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
