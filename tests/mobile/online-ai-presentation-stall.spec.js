import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import {
  attachConsoleErrorCapture,
  expectNoBlockingConsoleErrors,
} from '../helpers/ui.js';
import {
  prepareOnlineAiPresentationStallFixture,
  waitForOnlineAiPresentationStallRecovery,
} from '../helpers/online-ai-presentation-stall.js';

test.describe('Galaxy 온라인 AI presentation lock 경합', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('AI 이동 경합 중 새 snapshot을 받아도 다음 AI 던지기와 화면 전체 상태가 최신 서버 값에 수렴한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy viewport 전용 회귀 테스트입니다.');
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    const fixture = await prepareOnlineAiPresentationStallFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const result = await waitForOnlineAiPresentationStallRecovery(page, fixture);

    expect(result.winningMoveSequence.actorId).toBe(fixture.firstAiSeatId);
    expect(result.nextAiRollSequence.actorId).toBe(fixture.secondAiSeatId);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
