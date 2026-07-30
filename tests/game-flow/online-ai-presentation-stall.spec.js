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

test.describe('온라인 AI presentation lock 경합', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('AI 이동 경합 뒤 중복 이동 없이 다음 AI 턴과 최신 화면 상태로 수렴한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    const fixture = await prepareOnlineAiPresentationStallFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const result = await waitForOnlineAiPresentationStallRecovery(page, fixture);

    expect(result.winningMoveSequence.actorId).toBe(fixture.firstAiSeatId);
    expect(result.nextAiRollSequence.actorId).toBe(fixture.secondAiSeatId);
    await expect(page.getByTestId('game-screen')).toBeVisible();
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
