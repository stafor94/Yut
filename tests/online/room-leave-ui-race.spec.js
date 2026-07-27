import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { createRoomFromLobby, joinRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('waiting room leave UI race QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('방장 퇴장 시작부터 로비 이동까지 P1 좌석과 방장 액션이 잘못 노출되지 않는다', async ({ browser }, testInfo) => {
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'leave-race-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'leave-race-guest'));
    const roomTitle = makeQaName(testInfo, 'leave-race-room');
    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await runQaStep(testInfo, '퇴장 중 P1 연속 DOM 상태 관찰', async () => {
        await createRoomFromLobby(hostPage, roomTitle);
        roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
        expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();
        await joinRoomFromLobby(guestPage, roomTitle);
        await expect(hostPage.getByTestId('waiting-room')).toContainText(guestName);
        await expect(guestPage.getByTestId('waiting-room')).toContainText(hostName);

        await hostPage.evaluate(() => {
          const result = {
            mutationCount: 0,
            selfKickSeen: false,
            temporaryPlayerSeatSeen: false,
            leavePendingSeen: false,
          };
          const inspect = () => {
            result.mutationCount += 1;
            const waitingRoom = document.querySelector('[data-testid="waiting-room"]');
            if (!(waitingRoom instanceof HTMLElement)) return;
            const p1Card = Array.from(waitingRoom.querySelectorAll('.compact-ready-card'))
              .find((card) => card.querySelector('.seat-identity > b')?.textContent?.trim() === 'P1');
            if (!(p1Card instanceof HTMLElement)) return;
            if (p1Card.querySelector('.kick-player-button')) result.selfKickSeen = true;
            const role = p1Card.querySelector('.seat-role-badge')?.textContent?.trim() ?? '';
            const name = p1Card.querySelector('.human-seat-copy > strong')?.textContent?.trim() ?? '';
            if (role === '플레이어' && name === '플레이어') result.temporaryPlayerSeatSeen = true;
            const leaveButton = Array.from(waitingRoom.querySelectorAll('button'))
              .find((button) => button.textContent?.trim() === '나가는 중...');
            if (leaveButton instanceof HTMLButtonElement && leaveButton.disabled) result.leavePendingSeen = true;
          };
          const observer = new MutationObserver(inspect);
          observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
          inspect();
          window.__YUT_QA_LEAVE_UI_RACE__ = result;
          window.__YUT_QA_STOP_LEAVE_UI_RACE__ = () => observer.disconnect();
        });

        await hostPage.evaluate(() => {
          const button = Array.from(document.querySelectorAll('button'))
            .find((candidate) => candidate.textContent?.trim() === '방 나가기');
          if (!(button instanceof HTMLButtonElement)) throw new Error('방 나가기 버튼을 찾지 못했습니다.');
          button.click();
          button.click();
        });

        await expect(hostPage.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });
        await expect(guestPage.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });
        const guestDialog = guestPage.getByRole('alertdialog', { name: '방장이 방을 나갔습니다.' });
        await expect(guestDialog).toBeVisible({ timeout: 25_000 });
        await expect(guestDialog).toContainText('방이 종료되어 로비로 이동했습니다.');
        await expect.poll(async () => findRoomIdByTitle(roomTitle), { timeout: 25_000 }).toBeNull();

        const observed = await hostPage.evaluate(() => {
          window.__YUT_QA_STOP_LEAVE_UI_RACE__?.();
          return window.__YUT_QA_LEAVE_UI_RACE__;
        });
        expect(observed?.mutationCount, '퇴장 시작부터 대기실 제거까지 DOM 변경을 연속 관찰해야 합니다.').toBeGreaterThan(1);
        expect(observed?.leavePendingSeen, '퇴장 중에는 비활성 나가는 중 UI가 표시되어야 합니다.').toBe(true);
        expect(observed?.selfKickSeen, '퇴장 중 본인 P1 좌석에 강퇴 버튼이 나타나면 안 됩니다.').toBe(false);
        expect(observed?.temporaryPlayerSeatSeen, '퇴장 중 본인 P1 좌석이 임시 플레이어 좌석으로 바뀌면 안 됩니다.').toBe(false);
      });
    } finally {
      await guestContext.close();
      await hostContext.close();
    }
  });
});
