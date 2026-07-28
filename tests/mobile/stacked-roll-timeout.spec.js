import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import {
  attachConsoleErrorCapture,
  expectNoBlockingConsoleErrors,
} from '../helpers/ui.js';
import {
  prepareStackedRollTimeoutFixture,
  waitForStackedRollTimeoutRecovery,
} from '../helpers/stacked-roll-timeout.js';

test.describe('Galaxy 누적 이동 스택 제한시간 recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('412×915에서 버튼만 잠긴 채 멈추지 않고 새로고침 없이 다음 상태로 진행한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });

    const fixture = await prepareStackedRollTimeoutFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForStackedRollTimeoutRecovery(fixture);

    expect(recovery.sequence.action?.payload?.rollStackIndex).toBe(0);
    expect(recovery.state.rollStack).toEqual([{ name: '걸', steps: 3 }]);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(async () => {
      const pickerButtonCount = await page.locator('.roll-stack-picker button').count();
      const controlsVisible = await page.getByTestId('play-controls').isVisible().catch(() => false);
      const gameVisible = await page.getByTestId('game-screen').isVisible().catch(() => false);
      return gameVisible && controlsVisible && pickerButtonCount < 2;
    }, {
      timeout: 8_000,
      intervals: [100, 200, 400],
      message: 'Galaxy 화면이 다중 스택 선택 상태에 영구 고착되지 않아야 합니다.',
    }).toBe(true);
    expect(page.url()).toContain('/Yut/');
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
