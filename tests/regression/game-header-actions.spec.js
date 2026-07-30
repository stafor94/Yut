import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  baseStatisticsSeats,
  baseStatisticsSequences,
  installGameStatisticsFixture,
} from '../helpers/game-statistics-fixture.js';

const STANDARD_RESULT_PROBABILITIES = ['6.25%', '18.75%', '37.5%', '25%', '6.25%', '6.25%'];

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
    const buttonVisual = await guideButton.evaluate((button) => {
      const icon = button.querySelector('svg');
      const buttonStyle = getComputedStyle(button);
      return {
        backgroundImage: buttonStyle.backgroundImage,
        borderColor: buttonStyle.borderColor,
        iconStroke: icon ? getComputedStyle(icon).stroke : '',
      };
    });
    expect(buttonVisual.backgroundImage, '게임 방법 버튼은 베이지 패널과 구분되는 진한 배경이어야 합니다.').toContain('linear-gradient');
    expect(buttonVisual.borderColor).toBe('rgb(23, 60, 45)');
    expect(buttonVisual.iconStroke, '책 아이콘은 진한 버튼 위에서 밝게 보여야 합니다.').toBe('rgb(255, 253, 241)');
    await guideButton.click();

    const dialog = page.getByTestId('game-guide-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/lobby-howto-sheet/);
    await expect(dialog.getByRole('heading', { name: '게임 방법' })).toBeVisible();
    const resultPresentation = await dialog.evaluate((element) => {
      const summary = element.querySelector('.howto-result-probabilities');
      const resultItems = Array.from(element.querySelectorAll('.howto-result-strip span'));
      if (!(summary instanceof HTMLElement) || resultItems.length !== 6) throw new Error('윷 결과 안내 구조를 찾지 못했습니다.');
      return {
        summaryDisplay: getComputedStyle(summary).display,
        probabilities: resultItems.map((item) => getComputedStyle(item, '::before').content.replace(/^["']|["']$/g, '')),
      };
    });
    expect(resultPresentation.summaryDisplay, '등급별 확률 요약은 윷 결과에서 노출하지 않아야 합니다.').toBe('none');
    expect(resultPresentation.probabilities, '각 결과 확률은 이동 칸 수 바로 아래에 표시되어야 합니다.').toEqual(STANDARD_RESULT_PROBABILITIES);
    expect(await dialog.locator('.howto-results-section').innerText()).not.toMatch(/Perfect|Nice|Good|Bad/);
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
