import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture, expectAppShell, expectNoBlockingConsoleErrors, runQaStep } from '../helpers/ui.js';

test.describe('smoke QA', () => {
  test('앱 shell과 로비 핵심 UI가 로드된다', async ({ page }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    await runQaStep(testInfo, '앱 첫 화면 열기', async () => {
      await expectAppShell(page);
      await expect(page.getByTestId('room-title-input')).toBeVisible();
      await expect(page.getByTestId('create-room-button')).toBeVisible();
    });

    await runQaStep(testInfo, '치명적 콘솔 오류 없음 확인', async () => {
      expectNoBlockingConsoleErrors(consoleErrors);
    });
  });
});
