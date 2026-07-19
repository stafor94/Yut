import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('mobile lobby scroll reset QA', () => {
  test('대기실에서 로비로 나오면 문서 스크롤과 동적 뷰포트 하단이 함께 복구된다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'scroll-reset-host'));
    const roomTitle = makeQaName(testInfo, 'scroll-reset-room');
    let roomId;

    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '4',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });

    await runQaStep(testInfo, '대기실에서 로비 복귀 시 모바일 문서 스크롤과 동적 뷰포트 높이 복구 확인', async () => {
      try {
        await expectAppShell(page);
        await page.getByTestId('room-title-input').fill(roomTitle);
        await page.getByTestId('create-room-button').click();
        await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 20_000 });
        roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);

        await page.getByTestId('waiting-room').evaluate((waitingRoom) => {
          const spacer = document.createElement('div');
          spacer.dataset.testid = 'scroll-reset-spacer';
          spacer.style.height = '1200px';
          spacer.style.pointerEvents = 'none';
          waitingRoom.querySelector('.waiting-actions')?.before(spacer);
          window.scrollTo(0, document.documentElement.scrollHeight);
        });

        await expect.poll(() => page.evaluate(() => window.scrollY), {
          timeout: 5_000,
          message: '대기실에서 재현용 문서 스크롤이 발생해야 합니다.',
        }).toBeGreaterThan(0);

        const simulatedDynamicViewportHeight = await page.evaluate(() => {
          const height = window.innerHeight + 320;
          document.documentElement.style.setProperty('--app-viewport-height', `${height}px`);
          return height;
        });

        await page.getByRole('button', { name: '방 나가기' }).click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 10_000 });
        await expect.poll(() => page.evaluate(() => window.scrollY), {
          timeout: 5_000,
          message: '로비 전환 후 문서 스크롤은 상단으로 초기화되어야 합니다.',
        }).toBe(0);

        const viewportCoverage = await page.evaluate((expectedHeight) => {
          const shell = document.querySelector('[data-testid="app-shell"]');
          if (!(shell instanceof HTMLElement)) return null;
          const shellRect = shell.getBoundingClientRect();
          const target = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.max(0, window.innerHeight - 2));
          return {
            expectedHeight,
            shellHeight: shellRect.height,
            shellMinHeight: Number.parseFloat(window.getComputedStyle(shell).minHeight),
            bottomViewportIsInsideShell: Boolean(target?.closest('[data-testid="app-shell"]')),
          };
        }, simulatedDynamicViewportHeight);

        expect(viewportCoverage, '앱 셸의 뷰포트 측정값을 읽을 수 있어야 합니다.').not.toBeNull();
        expect(viewportCoverage.shellMinHeight, '로비 셸 최소 높이는 현재 동적 뷰포트 높이를 따라야 합니다.').toBeGreaterThanOrEqual(simulatedDynamicViewportHeight - 1);
        expect(viewportCoverage.shellHeight, '로비 배경은 동적 뷰포트 하단까지 이어져야 합니다.').toBeGreaterThanOrEqual(simulatedDynamicViewportHeight - 1);
        expect(viewportCoverage.bottomViewportIsInsideShell, '로비 하단 뷰포트가 앱 셸 밖의 빈 영역을 보여서는 안 됩니다.').toBe(true);
      } finally {
        if (roomId) await deleteRoomForQa(roomId);
      }
    });
  });
});