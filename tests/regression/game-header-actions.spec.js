import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  baseStatisticsSeats,
  baseStatisticsSequences,
  installGameStatisticsFixture,
} from '../helpers/game-statistics-fixture.js';

test.describe('진행 기록 헤더 액션', () => {
  test('P1은 Sequence Export를 보고 그 옆 게임 방법 버튼으로 로비와 같은 안내를 연다', async ({ page }) => {
    await expectAppShell(page);
    await installGameStatisticsFixture(page, {
      seats: baseStatisticsSeats,
      sequences: baseStatisticsSequences,
      localSeatId: 'p1',
      showSequenceExport: true,
      includeGameGuide: true,
    });

    const actions = page.locator('#qa-game-statistics-fixture .log-header-actions');
    expect(await actions.locator(':scope > button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual([
      '최신 상태와 전체 시퀀스 내보내기',
      '게임 방법 열기',
      '통계 정보 열기',
    ]);

    const guideButton = actions.getByRole('button', { name: '게임 방법 열기' });
    await expect(guideButton.locator('svg')).toBeVisible();
    await guideButton.click();

    const dialog = page.getByTestId('game-guide-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/lobby-howto-sheet/);
    await expect(dialog.getByRole('heading', { name: '게임 방법' })).toBeVisible();
    await expect(dialog.getByLabel('윷 결과 확률 안내')).toContainText('빽도 6.25%');
    await expect(dialog.getByRole('heading', { name: '타이밍', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '방 옵션' })).toBeVisible();
    await expect(dialog).toContainText('이미 게임 중인 방은 관전할 수 있습니다.');
    await dialog.getByRole('button', { name: '확인' }).click();
    await expect(dialog).toBeHidden();
    await expect(guideButton).toBeFocused();
  });

  test('P2는 Sequence Export 없이 게임 방법과 통계 버튼만 본다', async ({ page }) => {
    await expectAppShell(page);
    await installGameStatisticsFixture(page, {
      seats: baseStatisticsSeats,
      sequences: baseStatisticsSequences,
      localSeatId: 'p2',
      showSequenceExport: false,
      includeGameGuide: true,
    });

    const actions = page.locator('#qa-game-statistics-fixture .log-header-actions');
    await expect(actions.getByRole('button', { name: '최신 상태와 전체 시퀀스 내보내기' })).toHaveCount(0);
    expect(await actions.locator(':scope > button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual([
      '게임 방법 열기',
      '통계 정보 열기',
    ]);
    await expect(actions.getByRole('button', { name: '게임 방법 열기' })).toBeVisible();
  });
});
