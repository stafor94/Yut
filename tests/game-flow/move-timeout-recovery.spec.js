import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import {
  attachConsoleErrorCapture,
  expectNoBlockingConsoleErrors,
} from '../helpers/ui.js';
import { runBackDoNoMovableAutoPassQa } from '../helpers/backdo-no-movable-auto-pass.js';
import {
  expectMoveTimeoutRecoveryUiProgress,
  prepareMoveTimeoutRecoveryFixture,
  waitForMoveTimeoutRecovery,
} from '../helpers/move-timeout-stateless-duplicate.js';

test.describe('일반 말 이동 제한시간 recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('두 번째 연속 timeout 개 이동이 하나의 canonical action으로 완료된다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    const fixture = await prepareMoveTimeoutRecoveryFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForMoveTimeoutRecovery(fixture);

    expect(recovery.moveActionIds).toEqual([{
      sequence: expect.any(Number),
      clientMutationId: fixture.actionKey,
      actionClientId: fixture.actionKey,
    }]);
    expect(recovery.sequence.action?.payload?.rollStackIndex ?? null).toBeNull();
    expect(recovery.presentation.trace?.movingStarts).toBe(1);
    expect(recovery.presentation.trace?.benchReturns).toBe(0);
    expect(recovery.nextAiSequence?.type).toBe('roll_yut');
    expect(recovery.nextAiSequence?.actorId).not.toBe(fixture.actorId);
    await expectMoveTimeoutRecoveryUiProgress(page, {
      message: '복구 뒤 게임 화면을 유지하면서 timeout 이동을 재생하지 않고 다음 턴으로 진행해야 합니다.',
    });
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});

test.describe('온라인 빽도 no-movable 자동 패스', () => {
  test.setTimeout(120_000);

  test('판 위 말이 0개인 actor의 빽도는 사용자 조작 없이 정확히 한 번 소비되어 다음 턴으로 수렴한다', async ({ browser, page, context }, testInfo) => {
    await runBackDoNoMovableAutoPassQa({ browser, page, context, testInfo });
  });
});
