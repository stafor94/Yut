import { test, expect } from '@playwright/test';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { startGameStatisticsQaGame } from '../helpers/game-statistics-game.js';

test.describe('통계 정보 팝업 Desktop QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('진행 기록의 통계 버튼에서 플레이어별 실제 Sequence 통계를 확인한다', async ({ page, context }, testInfo) => {
    const started = await startGameStatisticsQaGame(page, context, testInfo, { playerCount: 2 });
    roomId = started.roomId;

    const logActions = page.locator('.log-header-actions');
    const exportButton = logActions.getByRole('button', { name: '최신 상태와 전체 시퀀스 내보내기' });
    const statisticsButton = page.getByTestId('game-statistics-button');
    await expect(exportButton).toBeVisible();
    await expect(statisticsButton).toBeVisible();
    await expect(statisticsButton).toHaveAttribute('aria-label', '통계 정보 열기');
    await expect(statisticsButton.locator('svg')).toHaveCount(1);

    const buttonOrder = await logActions.evaluate((element) => Array.from(element.querySelectorAll('button')).map((button) => button.getAttribute('aria-label')));
    expect(buttonOrder.indexOf('통계 정보 열기')).toBe(buttonOrder.indexOf('최신 상태와 전체 시퀀스 내보내기') + 1);

    await statisticsButton.click();
    const dialog = page.getByTestId('game-statistics-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '통계 정보' })).toBeVisible();

    const selectedTab = dialog.getByRole('tab', { selected: true });
    await expect(selectedTab).toContainText(started.hostName);
    await expect(dialog.locator('.game-statistics-record')).toHaveCount(1, { timeout: 15_000 });
    await expect(dialog.locator('.game-statistics-record').first()).toContainText(/^#\d+/);
    await expect(dialog.locator('.game-statistics-record').first().locator('.timing')).toContainText(/PERFECT|NICE|GOOD|BAD|미확인/);
    await expect(dialog.locator('.game-statistics-record').first().locator('.result')).toContainText(/빽도|도|개|걸|윷|모|낙|미확인/);

    await expect(dialog.locator('.game-statistics-summary')).toContainText('타이밍 결과');
    await expect(dialog.locator('.game-statistics-summary')).toContainText('윷 결과');
    await expect(dialog.locator('.game-statistics-summary')).toContainText('상대 말 잡기');
    const totalRollCount = await dialog.locator('.game-statistics-summary-grid').first().locator('strong').evaluateAll((nodes) => nodes.reduce((sum, node) => sum + Number(node.textContent?.match(/\d+/)?.[0] ?? 0), 0));
    expect(totalRollCount).toBe(1);

    const otherTab = dialog.getByRole('tab').filter({ hasNotText: started.hostName }).first();
    await otherTab.click();
    await expect(otherTab).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('.game-statistics-state.empty')).toContainText('윷 던지기 기록이 없습니다.');

    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();

    await statisticsButton.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { selected: true })).toContainText(started.hostName);
  });
});
