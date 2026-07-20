import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

const expectDialogCentered = async (dialog, label) => {
  const layout = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      dialogTop: rect.top,
      dialogBottom: rect.bottom,
      viewportCenter: window.innerHeight / 2,
      dialogCenter: rect.top + rect.height / 2,
    };
  });

  expect(layout.dialogTop, `${label} 상단이 화면 밖으로 나가면 안 됩니다.`).toBeGreaterThanOrEqual(-1);
  expect(layout.dialogBottom, `${label} 하단이 화면 밖으로 나가면 안 됩니다.`).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(Math.abs(layout.dialogCenter - layout.viewportCenter), `${label}은 화면 중앙에 배치되어야 합니다.`).toBeLessThanOrEqual(2);
};

test.describe('lobby guide and settings dialog behavior QA', () => {
  test('게임 방법과 설정은 중앙에 열리고 설정 저장 후 닫힌다', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '중앙팝업QA' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    await page.getByRole('button', { name: '게임 방법', exact: true }).click();
    const guideDialog = page.getByRole('dialog', { name: '게임 방법' });
    await expect(guideDialog).toBeVisible();
    await expectDialogCentered(guideDialog, '게임 방법 팝업');
    await guideDialog.getByRole('button', { name: '닫기', exact: true }).click();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: '설정' });
    const nicknameInput = settingsDialog.locator('#settings-nickname');
    const closeButton = settingsDialog.getByRole('button', { name: '취소', exact: true });
    await expect(settingsDialog).toBeVisible();
    await expectDialogCentered(settingsDialog, '설정 팝업');
    await expect(closeButton).toBeFocused();
    await expect(nicknameInput).not.toBeFocused();

    await nicknameInput.fill('저장후닫힘QA');
    await settingsDialog.getByRole('button', { name: '닉네임 저장', exact: true }).click();
    await expect(settingsDialog).toBeHidden();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const reopenedSettingsDialog = page.getByRole('dialog', { name: '설정' });
    await expect(reopenedSettingsDialog.locator('#settings-nickname')).toHaveValue('저장후닫힘QA');
  });
});
