import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import {
  attachConsoleErrorCapture,
  expectNoBlockingConsoleErrors,
} from '../helpers/ui.js';
import {
  expectMoveTimeoutRecoveryUiProgress,
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

  test('412×915에서 timeout 개 이동이 되감기 없이 정확히 한 번 실행된다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });

    const fixture = await prepareMoveTimeoutRecoveryFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForMoveTimeoutRecovery(fixture);

    expect(recovery.moveActionIds).toEqual([{
      sequence: expect.any(Number),
      clientMutationId: fixture.actionKey,
      actionClientId: fixture.actionKey,
    }]);
    expect(recovery.presentation.trace).toMatchObject({
      movingStarts: 1,
      benchReturns: 0,
      captureGhostMax: 0,
    });
    expect(recovery.presentation.trace?.nodePath).toEqual(expect.arrayContaining(['n02', 'n03']));
    expect(recovery.sequence.action?.payload?.rollStackIndex ?? null).toBeNull();
    expect(recovery.nextAiSequence?.type).toBe('roll_yut');
    expect(recovery.nextAiSequence?.actorId).not.toBe(fixture.actorId);
    await expectMoveTimeoutRecoveryUiProgress(page, {
      message: 'Galaxy 화면이 timeout 이동을 한 번 완료한 뒤 다음 턴으로 진행해야 합니다.',
    });
    expect(page.url()).toContain('/Yut/');
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
