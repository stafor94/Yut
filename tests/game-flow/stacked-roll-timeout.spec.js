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

test.describe('누적 이동 스택 제한시간 recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('deadline 직전 UI callback 없이도 coordinator가 첫 선택 가능한 스택을 정확히 한 번 소비한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    const fixture = await prepareStackedRollTimeoutFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForStackedRollTimeoutRecovery(fixture);

    expect(recovery.sequence.action?.payload).toMatchObject({
      clientActionId: fixture.actionKey,
      recoveredByCoordinator: true,
      rollStackIndex: 1,
      timeoutDeadlineAt: fixture.timeoutDeadlineAt,
    });
    expect(recovery.state.rollStack).toEqual([{ name: '빽도', steps: -1 }]);
    expect(recovery.state.selectedRollStackIndex).toBe(0);
    expect(recovery.state.rollStackClosed).toBe(true);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(async () => page.locator('.roll-stack-picker button').count(), {
      timeout: 8_000,
      message: '복구 후 다중 스택 선택 UI에 고착되면 안 됩니다.',
    }).toBeLessThan(2);
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
