import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { attachConsoleErrorCapture, expectNoBlockingConsoleErrors } from '../helpers/ui.js';
import { prepareHardAiAuthoritativeFixture, waitForHardAiAuthoritativeStrategy } from '../helpers/hard-ai-authoritative-strategy.js';

test.describe('어려움 AI authoritative 누적 이동 전략', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(150_000);
  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('개로 n06에 도착한 뒤 남은 도로 지름길에 진입한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    const fixture = await prepareHardAiAuthoritativeFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const result = await waitForHardAiAuthoritativeStrategy(fixture);
    expect(result.firstMove.action?.payload?.rollStackIndex).toBe(1);
    expect(result.secondMove.action?.payload?.branchChoice).toBe('shortcut');
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(() => page.locator('.roll-stack-picker button').count(), { timeout: 8_000 }).toBe(0);
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
