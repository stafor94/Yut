import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('lobby room refresh feedback QA', () => {
  test('게임 참가 최초 조회 후 수동 새로고침은 조회 중 상태를 표시하고 중복 요청을 막는다', async ({ page, context }) => {
    await primeLobbyStorage(context, { nickname: '새로고침QA' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    await page.evaluate(() => {
      window.__yutQaRefreshCount = 0;
      window.addEventListener('yut:refresh-rooms', () => {
        window.__yutQaRefreshCount += 1;
      });
    });

    await page.getByRole('button', { name: '게임 참가', exact: true }).click();
    const refreshButton = page.getByTestId('refresh-room-list-button');
    await expect(refreshButton).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__yutQaRefreshCount)).toBe(1);
    await refreshButton.click();

    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toHaveAttribute('aria-busy', 'true');
    await expect(refreshButton).toContainText('조회 중...');
    await expect(refreshButton.locator('.lobby-room-refresh-icon')).toHaveClass(/is-spinning/);
    await expect.poll(() => page.evaluate(() => window.__yutQaRefreshCount)).toBe(2);

    await refreshButton.evaluate((button) => button.click());
    await expect.poll(() => page.evaluate(() => window.__yutQaRefreshCount)).toBe(2);

    await page.evaluate(() => window.dispatchEvent(new Event('yut:rooms-refreshed')));
    await expect(refreshButton).toBeEnabled({ timeout: 2_000 });
    await expect(refreshButton).toHaveAttribute('aria-busy', 'false');
    await expect(refreshButton).toContainText('새로고침');
    await expect(refreshButton.locator('.lobby-room-refresh-icon')).not.toHaveClass(/is-spinning/);
  });
});
