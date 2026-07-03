import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('online room QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('방 생성 후 대기실에 진입한다', async ({ page, context }, testInfo) => {
    test.skip(!(await hasFirebaseConfig()), 'Firebase 설정이 없으면 온라인 방 lifecycle QA를 건너뜁니다.');
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'online-host'));
    const roomTitle = makeQaName(testInfo, 'online-room');
    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '온라인 방 생성 및 대기실 확인', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room'), `대기실 상태: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('waiting-room')).toContainText(nickname);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
    });
  });
});
