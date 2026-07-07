import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('cleanup/layout regression QA', () => {
  let roomIds;

  test.beforeEach(() => {
    roomIds = [];
  });

  test.afterEach(async () => {
    await Promise.allSettled(roomIds.map((roomId) => deleteRoomForQa(roomId)));
  });

  test('대기실과 로비 주요 버튼은 force click 없이 클릭 가능하고 로비 action column 정렬을 유지한다', async ({ page, context, browser }, testInfo) => {
    const waitingRoomNickname = normalizeQaNickname(makeQaName(testInfo, 'wait-host'));
    const waitingRoomTitle = makeQaName(testInfo, 'wait-room');
    const lobbyHostNickname = normalizeQaNickname(makeQaName(testInfo, 'card-host'));
    const lobbyGuestNickname = normalizeQaNickname(makeQaName(testInfo, 'card-guest'));
    const lobbyRoomTitle = makeQaName(testInfo, 'card-room');
    await primeLobbyStorage(context, { nickname: waitingRoomNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '방 생성 후 대기실 버튼 실제 클릭 가능 확인', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(waitingRoomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
      const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(waitingRoomTitle);
      if (roomId) roomIds.push(roomId);
      await page.getByTestId('add-ai-P2').click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    });

    await runQaStep(testInfo, '격리된 게스트 context에서 로비 방 카드 action column 정렬 확인', async () => {
      const lobbyHostContext = await browser.newContext();
      const lobbyGuestContext = await browser.newContext();
      await primeLobbyStorage(lobbyHostContext, { nickname: lobbyHostNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
      await primeLobbyStorage(lobbyGuestContext, { nickname: lobbyGuestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

      try {
        const lobbyHostPage = await lobbyHostContext.newPage();
        await expectAppShell(lobbyHostPage);
        await lobbyHostPage.getByTestId('room-title-input').fill(lobbyRoomTitle);
        await lobbyHostPage.getByTestId('create-room-button').click();
        await expect(lobbyHostPage.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
        const lobbyRoomId = await rememberRoomIdFromPage(lobbyHostPage) ?? await findRoomIdByTitle(lobbyRoomTitle);
        if (lobbyRoomId) roomIds.push(lobbyRoomId);

        const lobbyGuestPage = await lobbyGuestContext.newPage();
        await expectAppShell(lobbyGuestPage);
        await waitForBlockingOverlayToDisappear(lobbyGuestPage);
        const roomCard = lobbyGuestPage.locator('.lobby-room-card').filter({ hasText: lobbyRoomTitle }).first();
        await expect(roomCard).toBeVisible({ timeout: 20_000 });
        const statusBox = await roomCard.locator('.lobby-room-status').boundingBox();
        const actionBox = await roomCard.locator('.lobby-room-action').boundingBox();
        expect(statusBox, '대기중 배지 bounding box').not.toBeNull();
        expect(actionBox, '참여 버튼 bounding box').not.toBeNull();
        expect(Math.abs((statusBox.x + statusBox.width / 2) - (actionBox.x + actionBox.width / 2)), '대기중 배지와 참여 버튼은 같은 우측 action column 중앙에 있어야 합니다.').toBeLessThanOrEqual(8);
        const joinButton = roomCard.locator('.lobby-room-action');
        await expect(joinButton).toBeVisible({ timeout: 10_000 });
        await expect(joinButton).toBeEnabled({ timeout: 10_000 });
        await waitForBlockingOverlayToDisappear(lobbyGuestPage);
        await joinButton.click();
        await expect(lobbyGuestPage.getByTestId('waiting-room')).toBeVisible({ timeout: 20_000 });
      } finally {
        await lobbyGuestContext.close();
        await lobbyHostContext.close();
      }
    });
  });
});
