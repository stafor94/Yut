import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { attachConsoleErrorCapture, expectNoBlockingConsoleErrors } from '../helpers/ui.js';
import {
  prepareHardAiStackedStrategyFixture,
  waitForHardAiStackedStrategy,
} from '../helpers/hard-ai-stacked-strategy.js';

test.describe('어려움 AI 누적 이동 전략', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(150_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('개로 n06에 정확히 도착한 뒤 남은 도로 지름길에 진입한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    const fixture = await prepareHardAiStackedStrategyFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const result = await waitForHardAiStackedStrategy(fixture);

    expect(result.firstMove.action?.payload?.rollStackIndex).toBe(1);
    expect(result.secondMove.action?.payload?.branchChoice).toBe('shortcut');
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(async () => page.locator('.roll-stack-picker button').count(), {
      timeout: 8_000,
      message: 'hard AI authoritative sequence 완료 후 누적 이동 UI에 고착되면 안 됩니다.',
    }).toBe(0);
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
