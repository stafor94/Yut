import { test } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { exerciseStackedMoBackDoMoves, prepareStackedMoveIdentityFixture } from '../helpers/stacked-move-selection-identity.js';

test.describe('online stacked move selection identity', () => {
  test.setTimeout(120_000);
  let roomId = '';
  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = '';
  });

  test('[모, 빽도]는 모 이동을 되감지 않고 빽도를 같은 턴에 한 번 더 소비한다', async ({ page, context }, testInfo) => {
    const fixture = await prepareStackedMoveIdentityFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    await exerciseStackedMoBackDoMoves(page, fixture);
  });
});
