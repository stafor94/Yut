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
    const guideButtonVisual = await guideButton.evaluate((button) => {
      const svg = button.querySelector('svg');
      const style = getComputedStyle(button);
      return {
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        color: style.color,
        svgStroke: svg ? getComputedStyle(svg).stroke : '',
      };
    });
    expect(guideButtonVisual.backgroundImage, '게임 방법 버튼은 주변 크림색 버튼과 구분되는 채움색을 사용해야 합니다.').toContain('linear-gradient');
    expect(guideButtonVisual.borderColor).not.toBe('rgba(122, 74, 38, 0.18)');
    expect(guideButtonVisual.boxShadow).not.toBe('none');
    expect(guideButtonVisual.color).not.toBe('rgb(122, 74, 38)');
    expect(guideButtonVisual.svgStroke).not.toBe('rgb(91, 50, 28)');
    await guideButton.click();

    const dialog = page.getByTestId('game-guide-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/lobby-howto-sheet/);
    await expect(dialog.getByRole('heading', { name: '게임 방법' })).toBeVisible();
    const resultItems = dialog.locator('.howto-result-strip > span');
    await expect(resultItems).toHaveCount(6);
    expect((await resultItems.allTextContents()).map((text) => text.replace(/\s/g, ''))).toEqual([
      '빽도-1칸6.25%',
      '도1칸18.75%',
      '개2칸37.5%',
      '걸3칸25%',
      '윷4칸6.25%',
      '모5칸6.25%',
    ]);
    await expect(dialog.locator('.howto-result-probabilities')).toHaveCount(0);
    await expect(dialog.locator('.howto-results-section')).not.toContainText(/Perfect|Nice/);
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
