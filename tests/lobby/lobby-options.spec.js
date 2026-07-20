import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';

test.describe('lobby QA', () => {
  test('로비 저장 옵션과 중앙 방 만들기 팝업이 현재 화면에 반영된다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'nick'));
    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '저장된 로비 값으로 앱 열기', async () => {
      await expectAppShell(page);
      const nicknameDisplay = page.getByTestId('lobby-nickname-display');
      await expect(nicknameDisplay).toBeVisible();
      await expect(nicknameDisplay).toContainText(nickname);
      await expect(nicknameDisplay).toHaveAttribute('aria-label', `닉네임: ${nickname}`);
      await expect(nicknameDisplay).toBeDisabled();
      await expect(page.getByRole('button', { name: `닉네임 수정: ${nickname}` })).toHaveCount(0);
      await page.getByRole('button', { name: '방 만들기', exact: true }).click();
      const createDialog = page.getByRole('dialog', { name: '방 만들기' });
      await expect(createDialog).toBeVisible();
      await expect(page.getByTestId('room-title-input')).toBeVisible();
      await expect(page.getByTestId('room-title-input')).toBeFocused();
      await expect(page.getByTestId('create-room-button')).toBeEnabled();

      const geometry = await createDialog.evaluate((dialog) => {
        const heading = dialog.querySelector('.lobby-simple-sheet-heading');
        const title = heading?.querySelector('h2');
        const close = heading?.querySelector('.sheet-close');
        if (!(heading instanceof HTMLElement) || !(title instanceof HTMLElement) || !(close instanceof HTMLElement)) return null;
        const dialogRect = dialog.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const closeRect = close.getBoundingClientRect();
        return {
          dialogCenterY: dialogRect.top + dialogRect.height / 2,
          viewportCenterY: window.innerHeight / 2,
          titleCenterY: titleRect.top + titleRect.height / 2,
          closeCenterY: closeRect.top + closeRect.height / 2,
          closeWidth: closeRect.width,
          closeRight: closeRect.right,
          headingRight: headingRect.right,
        };
      });

      expect(geometry, '방 만들기 팝업 위치와 헤더를 읽을 수 있어야 합니다.').not.toBeNull();
      expect(Math.abs(geometry.dialogCenterY - geometry.viewportCenterY), '방 만들기 팝업은 화면 중앙에 배치되어야 합니다.').toBeLessThanOrEqual(70);
      expect(Math.abs(geometry.titleCenterY - geometry.closeCenterY), '닫기 버튼은 방 만들기 타이틀과 같은 행에 있어야 합니다.').toBeLessThanOrEqual(10);
      expect(geometry.closeWidth, '방 만들기 닫기 버튼은 작게 유지해야 합니다.').toBeLessThanOrEqual(34);
      expect(geometry.headingRight - geometry.closeRight, '닫기 버튼은 헤더 우측 끝에 있어야 합니다.').toBeLessThanOrEqual(2);
    });
  });
});
