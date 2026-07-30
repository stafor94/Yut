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

  test('412×915에서 비활성 빽도를 건너뛰고 새로고침 없이 다음 상태로 진행한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });

    const fixture = await prepareStackedRollTimeoutFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForStackedRollTimeoutRecovery(fixture);

    expect(recovery.sequence.action?.payload?.rollStackIndex).toBe(1);
    expect(recovery.state.rollStack).toEqual([{ name: '빽도', steps: -1 }]);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const gameScreen = document.querySelector('[data-testid="game-screen"]');
      const playControls = document.querySelector('[data-testid="play-controls"]');
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const pickerButtonCount = document.querySelectorAll('.roll-stack-picker button').length;
      const isRendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const staleMoveButtonLocked = isRendered(moveButton) && moveButton.hasAttribute('disabled');
      return isRendered(gameScreen)
        && Boolean(playControls)
        && pickerButtonCount < 2
        && !staleMoveButtonLocked;
    }), {
      timeout: 8_000,
      intervals: [100, 200, 400],
      message: 'Galaxy 화면이 다중 스택 선택 또는 비활성 이동 버튼 상태에 영구 고착되지 않아야 합니다.',
    }).toBe(true);
    expect(page.url()).toContain('/Yut/');
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
