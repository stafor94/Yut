import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('lobby start screen QA', () => {
  test('최초 사용자는 유효한 닉네임을 저장해야 로비 기능을 사용할 수 있다', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.removeItem('yut-online:nickname');
    });

    await expectAppShell(page);
    const nicknameDialog = page.getByRole('dialog', { name: '닉네임 설정' });
    await expect(nicknameDialog).toBeVisible();

    const nicknameInput = nicknameDialog.getByPlaceholder('닉네임');
    const startButton = nicknameDialog.getByRole('button', { name: '시작하기' });
    await nicknameInput.fill('가');
    await expect(startButton).toBeDisabled();
    await nicknameInput.fill('가나');
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await expect(nicknameDialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:nickname'))).toBe('가나');
    await expect(page.getByRole('button', { name: '방 만들기', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '게임 참가', exact: true })).toBeEnabled();
  });

  test('로비 팝업은 실시간 목록 안내, 공통 닫기, 설정 저장을 제공한다', async ({ page, context }) => {
    await primeLobbyStorage(context, { nickname: '가나' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    const joinTrigger = page.getByRole('button', { name: '게임 참가', exact: true });
    await joinTrigger.click();
    const joinDialog = page.getByRole('dialog', { name: '게임 참가' });
    await expect(joinDialog).toBeVisible();
    await expect(joinDialog).toContainText('실시간 자동 갱신');
    await page.keyboard.press('Escape');
    await expect(joinDialog).toBeHidden();
    await expect(joinTrigger).toBeFocused();

    await page.getByRole('button', { name: '게임 방법', exact: true }).click();
    const howToDialog = page.getByRole('dialog', { name: '게임 방법' });
    await expect(howToDialog).toBeVisible();
    await expect(howToDialog).toContainText('재접속과 관전');
    await howToDialog.getByRole('button', { name: '확인하고 시작하기' }).click();
    await expect(howToDialog).toBeHidden();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: '설정' });
    const nicknameInput = settingsDialog.getByLabel('닉네임');
    const saveButton = settingsDialog.getByRole('button', { name: '닉네임 저장' });
    await nicknameInput.fill('가');
    await expect(saveButton).toBeDisabled();
    await nicknameInput.fill('가나다');
    await saveButton.click();
    await expect(settingsDialog).toContainText('닉네임이 저장되었습니다.');
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:nickname'))).toBe('가나다');

    const soundToggle = settingsDialog.getByRole('checkbox', { name: /효과음/ });
    await soundToggle.uncheck();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('yut-online:soundEnabled'))).toBe('false');
  });
});
