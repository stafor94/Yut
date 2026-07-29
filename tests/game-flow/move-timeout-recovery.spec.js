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

test.describe('일반 말 이동 제한시간 recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('UI 자동 callback 없이 coordinator가 grace 이후 일반 개 이동을 정확히 한 번 복구한다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    const fixture = await prepareMoveTimeoutRecoveryFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForMoveTimeoutRecovery(fixture);

    expect(recovery.sequence.action?.payload).toMatchObject({
      clientActionId: fixture.actionKey,
      coordinatorEpoch: fixture.coordinatorEpoch,
      coordinatorSeatId: fixture.coordinatorSeatId,
      recoveredByCoordinator: true,
      reason: 'stalled-roll-move-timeout',
      timeoutDeadlineAt: fixture.timeoutDeadlineAt,
    });
    expect(recovery.sequence.action?.payload?.rollStackIndex ?? null).toBeNull();
    await expectMoveTimeoutRecoveryUiProgress(page, {
      message: '복구 뒤 게임 화면을 유지하면서 기존 일반 이동 버튼만 잠긴 상태에 고착되면 안 됩니다.',
    });
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
