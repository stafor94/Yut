import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';

const NICKNAME_STORAGE_KEY = 'yut-online:nickname';

test.describe('닉네임 설정 팝업', () => {
  test('최초 접속 시 닉네임 설정 팝업을 즉시 한 개 제목으로 표시한다', async ({ page }) => {
    await page.addInitScript((storageKey) => window.localStorage.removeItem(storageKey), NICKNAME_STORAGE_KEY);
    await expectAppShell(page);

    const dialog = page.getByRole('dialog', { name: '닉네임 설정' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '반가워요!', exact: true })).toHaveCount(1);
    await expect(dialog.getByRole('heading')).toHaveCount(1);
    await expect(dialog.locator('.section-kicker')).toHaveCount(0);
  });

  test('저장된 닉네임이 있는 기존 접속자는 설정 팝업을 자동 표시하지 않는다', async ({ page }) => {
    await page.addInitScript(({ storageKey, nickname }) => window.localStorage.setItem(storageKey, nickname), {
      storageKey: NICKNAME_STORAGE_KEY,
      nickname: '기존유저',
    });
    await expectAppShell(page);

    await expect(page.getByRole('dialog', { name: '닉네임 설정' })).toHaveCount(0);
  });
});
