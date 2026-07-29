import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import {
  attachConsoleErrorCapture,
  expectNoBlockingConsoleErrors,
} from '../helpers/ui.js';
import {
  prepareMoveTimeoutRecoveryFixture,
  waitForMoveTimeoutRecovery,
} from '../helpers/move-timeout-recovery.js';

test.describe('Galaxy 일반 말 이동 제한시간 recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('412×915에서 이동 버튼만 잠긴 채 멈추지 않고 새로고침 없이 진행한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });

    const fixture = await prepareMoveTimeoutRecoveryFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForMoveTimeoutRecovery(fixture);

    expect(recovery.sequence.action?.payload?.clientActionId).toBe(fixture.actionKey);
    expect(recovery.sequence.action?.payload?.rollStackIndex ?? null).toBeNull();
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect(page.getByTestId('play-controls')).toBeVisible();
    await expect.poll(async () => {
      const gameVisible = await page.getByTestId('game-screen').isVisible().catch(() => false);
      const controlsVisible = await page.getByTestId('play-controls').isVisible().catch(() => false);
      const button = page.getByTestId('move-piece-button');
      const staleMoveButtonVisible = await button.isVisible().catch(() => false);
      const staleMoveButtonDisabled = staleMoveButtonVisible
        ? await button.isDisabled().catch(() => false)
        : false;
      return gameVisible && controlsVisible && !(staleMoveButtonVisible && staleMoveButtonDisabled);
    }, {
      timeout: 8_000,
      intervals: [100, 200, 400],
      message: 'Galaxy 화면이 만료된 일반 이동 버튼만 잠긴 상태에 영구 고착되지 않아야 합니다.',
    }).toBe(true);
    expect(page.url()).toContain('/Yut/');
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
