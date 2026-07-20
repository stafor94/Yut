import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';

test.describe('lobby QA', () => {
  test('로비 저장 옵션이 현재 화면에 반영된다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'nick'));
    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '저장된 로비 값으로 앱 열기', async () => {
      await expectAppShell(page);
      const nicknameDisplay = page.getByTestId('lobby-nickname-display');
      await expect(nicknameDisplay).toBeVisible();
      await expect(nicknameDisplay).toContainText(nickname);
      await expect(nicknameDisplay).toHaveAttribute('aria-label', `설정 열기: ${nickname}`);
      await expect(page.getByRole('button', { name: `닉네임 수정: ${nickname}` })).toHaveCount(0);
      await page.getByRole('button', { name: '방 만들기', exact: true }).click();
      const createDialog = page.getByRole('dialog', { name: '방 만들기' });
      await expect(createDialog).toBeVisible();
      await expect(page.getByTestId('room-title-input')).toBeVisible();
      await expect(page.getByTestId('create-room-button')).toBeEnabled();
    });
  });
});
