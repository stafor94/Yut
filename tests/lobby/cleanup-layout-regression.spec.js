import { test, expect } from '@playwright/test';
import { createRoomFromLobby, expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
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

  test('대기실과 로비 주요 버튼은 force click 없이 클릭 가능하고 로비 컴팩트 카드 정렬을 유지한다', async ({ page, context, browser }, testInfo) => {
    const waitingRoomNickname = normalizeQaNickname(makeQaName(testInfo, 'wait-host'));
    const waitingRoomTitle = makeQaName(testInfo, 'wait-room');
    const lobbyHostNickname = normalizeQaNickname(makeQaName(testInfo, 'card-host'));
    const lobbyGuestNickname = normalizeQaNickname(makeQaName(testInfo, 'card-guest'));
    const lobbyRoomTitle = makeQaName(testInfo, 'card-room');
    await primeLobbyStorage(context, { nickname: waitingRoomNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '방 생성 후 대기실 버튼 실제 클릭 가능 확인', async () => {
      await createRoomFromLobby(page, waitingRoomTitle);
      const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(waitingRoomTitle);
      if (roomId) roomIds.push(roomId);
      const settingsToggle = page.getByTestId('waiting-room-settings-toggle');
      await expect(page.locator('.waiting-room-rule-badges')).toHaveCount(0);
      await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('group', { name: '진행' })).toBeVisible();
      await expect(page.getByTestId('waiting-room-settings-summary')).toHaveText('개인전 · 2인 · 말 4개 · 아이템 OFF · 누적 OFF');
      await page.locator('.play-mode-group').getByText('팀전').click();
      await page.locator('.piece-count-group').getByText('2개').click();
      await page.locator('.stacked-roll-mode-group').getByText('ON').click();
      await expect(page.getByTestId('waiting-room-settings-summary')).toHaveText('팀전 · 4인 · 말 2개 · 아이템 OFF · 누적 ON');
      const setupLayout = await page.locator('.waiting-setup-card').evaluate((element) => {
        const bodyWidth = document.documentElement.clientWidth;
        const box = element.getBoundingClientRect();
        return {
          right: box.right,
          bodyWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(setupLayout.right, '대기실 방 설정 카드는 화면 밖으로 넘치면 안 됩니다.').toBeLessThanOrEqual(setupLayout.bodyWidth + 1);
      expect(setupLayout.documentScrollWidth, '대기실 방 설정 카드는 가로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(setupLayout.bodyWidth + 1);
      const p2Card = page.locator('.compact-ready-card').filter({ hasText: 'P2' }).first();
      await expect(p2Card.locator('.team-card-option.red')).toHaveClass(/active/, { timeout: 10_000 });
      await page.getByTestId('add-ai-P2').click();
      await page.getByTestId('add-ai-P3').click();
      await page.getByTestId('add-ai-P4').click();
      const teamChecklist = page.locator('.team-checklist');
      await expect(teamChecklist).toContainText('청팀 2/2', { timeout: 15_000 });
      await expect(teamChecklist).toContainText('홍팀 2/2', { timeout: 15_000 });
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    });

    await runQaStep(testInfo, '격리된 게스트 context에서 로비 컴팩트 카드 정렬 확인', async () => {
      const lobbyHostContext = await browser.newContext();
      const lobbyGuestContext = await browser.newContext();
      await primeLobbyStorage(lobbyHostContext, { nickname: lobbyHostNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
      await primeLobbyStorage(lobbyGuestContext, { nickname: lobbyGuestNickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

      try {
        const lobbyHostPage = await lobbyHostContext.newPage();
        await createRoomFromLobby(lobbyHostPage, lobbyRoomTitle);
        const lobbyRoomId = await rememberRoomIdFromPage(lobbyHostPage) ?? await findRoomIdByTitle(lobbyRoomTitle);
        if (lobbyRoomId) roomIds.push(lobbyRoomId);

        const lobbyGuestPage = await lobbyGuestContext.newPage();
        await expectAppShell(lobbyGuestPage);
        await waitForBlockingOverlayToDisappear(lobbyGuestPage);
        await expect(
          lobbyGuestPage.getByRole('button', { name: /서버 상태: 온라인/ }),
          '게스트의 익명 인증과 방 목록 구독이 완료되어야 합니다.',
        ).toBeVisible({ timeout: 30_000 });
        await lobbyGuestPage.getByRole('button', { name: '방 참가', exact: true }).click();
        await expect(lobbyGuestPage.getByRole('dialog', { name: '방 참가' })).toBeVisible();
        const roomCard = lobbyGuestPage.locator('.lobby-room-card').filter({ hasText: lobbyRoomTitle }).first();
        await expect(roomCard).toBeVisible({ timeout: 25_000 });
        const stateDot = roomCard.locator('.lobby-room-state-dot');
        const occupancy = roomCard.locator('.lobby-room-occupancy');
        const joinButton = roomCard.locator('.lobby-room-action');
        await expect(stateDot).toBeVisible({ timeout: 10_000 });
        await expect(stateDot).toHaveAttribute('aria-label', '대기중');
        await expect(occupancy).toHaveText(/^\d+\/2명$/);
        await expect(joinButton).toBeVisible({ timeout: 10_000 });
        await expect(joinButton).toBeEnabled({ timeout: 10_000 });

        const titleBox = await roomCard.locator('.lobby-room-title-row').boundingBox();
        const metaBox = await roomCard.locator('.lobby-room-meta').boundingBox();
        const occupancyBox = await occupancy.boundingBox();
        const actionBox = await joinButton.boundingBox();
        expect(titleBox, '방 제목 행 bounding box').not.toBeNull();
        expect(metaBox, '방 옵션 행 bounding box').not.toBeNull();
        expect(occupancyBox, '현재 인원 bounding box').not.toBeNull();
        expect(actionBox, '참여 버튼 bounding box').not.toBeNull();
        expect(titleBox.x + titleBox.width, '방 제목은 현재 인원 영역을 침범하면 안 됩니다.').toBeLessThanOrEqual(occupancyBox.x + 1);
        expect(occupancyBox.x + occupancyBox.width, '현재 인원은 참여 버튼 영역을 침범하면 안 됩니다.').toBeLessThanOrEqual(actionBox.x + 1);
        expect(metaBox.x + metaBox.width, '방 옵션은 참여 버튼 영역을 침범하면 안 됩니다.').toBeLessThanOrEqual(actionBox.x + 1);

        await waitForBlockingOverlayToDisappear(lobbyGuestPage);
        await joinButton.click();
        await expect(lobbyGuestPage.getByTestId('waiting-room')).toBeVisible({ timeout: 20_000 });
        await expect(lobbyGuestPage.getByTestId('waiting-room-settings-toggle')).toHaveCount(0);
        await expect(lobbyGuestPage.getByTestId('waiting-room-settings-label')).toBeVisible();
        await expect(lobbyGuestPage.getByRole('group', { name: '진행' })).toHaveCount(0);
      } finally {
        await lobbyGuestContext.close();
        await lobbyHostContext.close();
      }
    });
  });
});
