import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { exerciseStackedMoBackDoMoves, prepareStackedMoveIdentityFixture } from '../helpers/stacked-move-selection-identity.js';

test.describe('Galaxy stacked move selection identity', () => {
  test.setTimeout(120_000);
  let roomId = '';
  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = '';
  });

  test('412×915 [모, 빽도] 이동도 동일 authoritative identity로 한 번씩 실행한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });
    const fixture = await prepareStackedMoveIdentityFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    await exerciseStackedMoBackDoMoves(page, fixture);
  });
});
