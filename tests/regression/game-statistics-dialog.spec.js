import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  baseStatisticsSeats,
  baseStatisticsSequences,
  installGameStatisticsFixture,
} from '../helpers/game-statistics-fixture.js';

test.describe('진행 기록 통계 정보 팝업', () => {
  test('Sequence Export 옆에서 열리고 내 좌석 기본 선택·탭 전환·현재 게임 통계를 표시한다', async ({ page }) => {
    await expectAppShell(page);
    await installGameStatisticsFixture(page, {
      seats: baseStatisticsSeats,
      sequences: baseStatisticsSequences,
      localSeatId: 'p2',
    });

    const actions = page.locator('#qa-game-statistics-fixture .log-header-actions');
    const exportButton = actions.getByRole('button', { name: '최신 상태와 전체 시퀀스 내보내기' });
    const statisticsButton = actions.getByRole('button', { name: '통계 정보 열기' });
    await expect(exportButton).toBeVisible();
    await expect(statisticsButton).toBeVisible();
    expect(await actions.locator(':scope > button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual([
      '최신 상태와 전체 시퀀스 내보내기',
      '통계 정보 열기',
    ]);
    await expect(statisticsButton.locator('svg')).toBeVisible();

    await statisticsButton.dispatchEvent('click');
    await expect.poll(() => page.evaluate(() => window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__.length)).toBe(1);
    const dialog = page.getByTestId('game-statistics-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '통계 정보' })).toBeVisible();

    const tabs = dialog.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(dialog.getByRole('tab', { name: '둘째' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tab', { name: /AI 단풍/ })).toContainText('AI');
    await expect(dialog.getByTestId('game-statistics-record').nth(0)).toContainText('#6');
    await expect(dialog.getByTestId('game-statistics-record').nth(0)).toContainText('낙');
    await expect(dialog.getByTestId('game-statistics-record').nth(1)).toContainText('#8');
    await expect(dialog.getByLabel('타이밍 결과 BAD').first()).toHaveText('B');

    await dialog.getByRole('tab', { name: '첫째' }).click();
    await expect(dialog.getByRole('tab', { name: '첫째' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByTestId('game-statistics-record').nth(0)).toContainText('#7');
    await expect(dialog.getByTestId('game-statistics-record').nth(1)).toContainText('#9');
    await expect(dialog.getByLabel('타이밍 결과 GOOD')).toHaveText('G');
    await expect(dialog.getByLabel('타이밍 결과 PERFECT')).toHaveText('P');
    await expect(dialog.getByRole('region', { name: '타이밍 결과 통계' })).toContainText('50%');
    await expect(dialog.getByRole('region', { name: '윷 결과 통계' })).toContainText('모');
    await expect(dialog.getByTestId('game-statistics-capture-count')).toHaveText('상대 말 잡기 2회');
    await expect(dialog.getByText('미확인', { exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText('#-9');
    await expect(dialog).not.toContainText('#-8');
    await expect(dialog).not.toContainText('상대 말 잡기 5회');

    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
    await statisticsButton.click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__.length)).toBe(2);
  });

  test('새 게임에 roll 기록이 없으면 이전 게임 기록 대신 빈 상태를 표시한다', async ({ page }) => {
    await expectAppShell(page);
    await installGameStatisticsFixture(page, {
      seats: baseStatisticsSeats.slice(0, 2),
      localSeatId: 'p1',
      latestState: {
        startRequestVersion: 2,
        startRequestId: 'statistics-empty-game-2',
        lastSequence: 20,
      },
      sequences: [
        { id: 'old-init', sequence: 1, type: 'game_initialized', actorId: 'p1', payload: { startRequestVersion: 1, startRequestId: 'statistics-empty-game-1' } },
        { id: 'old-roll', sequence: 2, type: 'roll_yut', actorId: 'p1', payload: { timingZone: 'perfect', displayRoll: { name: '모', steps: 5, bonus: true }, fallOccurred: false } },
        { id: 'old-capture', sequence: 3, type: 'move_piece_resolved', actorId: 'p1', payload: { captured: true, capturedPieceIds: ['p2-piece-1', 'p2-piece-2'] } },
        { id: 'current-init', sequence: 20, type: 'game_initialized', actorId: 'p1', payload: { startRequestVersion: 2, startRequestId: 'statistics-empty-game-2' } },
      ],
      delayMs: 10,
    });

    await page.getByRole('button', { name: '통계 정보 열기' }).click();
    const dialog = page.getByTestId('game-statistics-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('아직 윷 던지기 기록이 없습니다.')).toBeVisible();
    await expect(dialog.getByTestId('game-statistics-record')).toHaveCount(0);
    await expect(dialog.getByTestId('game-statistics-capture-count')).toHaveText('상대 말 잡기 0회');
    await expect(dialog).not.toContainText('#2');
  });

  test('Desktop에서 6열 기록을 좌측 정렬하고 footer 계층과 기록 전용 스크롤을 유지한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectAppShell(page);
    const sequences = Array.from({ length: 73 }, (_, index) => ({
      id: `desktop-roll-${index + 1}`,
      sequence: index + 1,
      type: 'roll_yut',
      actorId: 'p1',
      payload: {
        timingZone: ['perfect', 'nice', 'good', 'bad'][index % 4],
        displayRoll: { name: ['도', '개', '걸', '윷', '모'][index % 5] },
        fallOccurred: false,
      },
    }));
    await installGameStatisticsFixture(page, {
      seats: baseStatisticsSeats.slice(0, 1),
      sequences,
      localSeatId: 'p1',
      delayMs: 10,
    });

    await page.getByRole('button', { name: '통계 정보 열기' }).click();
    const dialog = page.getByTestId('game-statistics-dialog');
    const records = dialog.getByTestId('game-statistics-records');
    const footer = dialog.getByTestId('game-statistics-footer');
    const heading = dialog.getByRole('heading', { name: '통계 정보' });
    const rows = dialog.getByTestId('game-statistics-record-row');
    await expect(rows).toHaveCount(13);
    await expect(records).toHaveCSS('overflow-y', 'auto');
    await expect(records).toHaveCSS('align-content', 'start');
    await expect(records).toHaveCSS('justify-content', 'start');
    await expect(footer).toBeVisible();
    await expect(heading).toBeVisible();

    const layout = await dialog.evaluate((element) => {
      const recordsElement = element.querySelector('[data-testid="game-statistics-records"]');
      const footerElement = element.querySelector('[data-testid="game-statistics-footer"]');
      const headingElement = element.querySelector('h2');
      if (!(recordsElement instanceof HTMLElement) || !(footerElement instanceof HTMLElement) || !(headingElement instanceof HTMLElement)) throw new Error('통계 팝업 구조를 찾지 못했습니다.');
      const box = element.getBoundingClientRect();
      const recordsBox = recordsElement.getBoundingClientRect();
      const footerBox = footerElement.getBoundingClientRect();
      const headingBox = headingElement.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        recordsTop: recordsBox.top,
        recordsBottom: recordsBox.bottom,
        footerTop: footerBox.top,
        footerBottom: footerBox.bottom,
        headingTop: headingBox.top,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.headingTop).toBeGreaterThanOrEqual(layout.top);
    expect(layout.recordsTop).toBeGreaterThan(layout.headingTop);
    expect(layout.recordsBottom).toBeLessThanOrEqual(layout.footerTop);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.bottom);
  });
});
