import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import {
  baseStatisticsSeats,
  baseStatisticsSequences,
  installGameStatisticsFixture,
} from '../helpers/game-statistics-fixture.js';

test.describe('진행 기록 통계 정보 팝업', () => {
  test('Sequence Export 옆에서 열리고 내 좌석 기본 선택·탭 전환·통계를 표시한다', async ({ page }) => {
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

    await statisticsButton.click();
    await expect(page.getByTestId('game-statistics-loading')).toBeVisible();
    const dialog = page.getByTestId('game-statistics-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '통계 정보' })).toBeVisible();

    const tabs = dialog.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(dialog.getByRole('tab', { name: '둘째' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tab', { name: /AI 단풍/ })).toContainText('AI');
    await expect(dialog.getByTestId('game-statistics-record').nth(0)).toContainText('#8');
    await expect(dialog.getByTestId('game-statistics-record').nth(0)).toContainText('BAD');
    await expect(dialog.getByTestId('game-statistics-record').nth(1)).toContainText('#6');
    await expect(dialog.getByTestId('game-statistics-record').nth(1)).toContainText('낙');

    await dialog.getByRole('tab', { name: '첫째' }).click();
    await expect(dialog.getByRole('tab', { name: '첫째' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByTestId('game-statistics-record').nth(0)).toContainText('#9');
    await expect(dialog.getByTestId('game-statistics-record').nth(1)).toContainText('#7');
    await expect(dialog.getByRole('region', { name: '타이밍 결과 통계' })).toContainText('50%');
    await expect(dialog.getByRole('region', { name: '윷 결과 통계' })).toContainText('모');
    await expect(dialog.getByTestId('game-statistics-capture-count')).toHaveText('상대 말 잡기 2회');

    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
    await statisticsButton.click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__.length)).toBe(2);
  });

  test('실패 후 다시 불러오고 방 변경 중 이전 요청 결과를 폐기한다', async ({ page }) => {
    await expectAppShell(page);
    const roomASeats = [{ id: 'a1', label: 'P1', name: '이전 방', color: 'red', team: '청팀', seatIndex: 0 }];
    const roomBSeats = [{ id: 'b1', label: 'P1', name: '새 방', color: 'blue', team: '홍팀', seatIndex: 0 }];
    await installGameStatisticsFixture(page, {
      roomId: 'room-a',
      localSeatId: 'b1',
      seats: roomASeats,
      sequences: [],
      failuresBeforeSuccess: 1,
      roomData: {
        'room-a': { seats: roomASeats, sequences: [], delayMs: 40 },
        'room-b': { seats: roomBSeats, sequences: [{ id: 'b-roll', sequence: 3, type: 'roll_yut', actorId: 'b1', payload: { timingZone: 'nice', displayRoll: { name: '걸', steps: 3 }, fallOccurred: false } }], delayMs: 20 },
      },
    });

    const statisticsButton = page.getByRole('button', { name: '통계 정보 열기' });
    await statisticsButton.click();
    const dialog = page.getByTestId('game-statistics-dialog');
    await expect(dialog.getByTestId('game-statistics-error')).toContainText('QA 통계 조회 실패');
    await dialog.getByRole('button', { name: '다시 불러오기' }).click();
    await expect(dialog.getByRole('tab', { name: '이전 방' })).toBeVisible();
    await dialog.getByRole('button', { name: '닫기' }).click();

    await page.evaluate(() => {
      window.__YUT_QA_GAME_STATISTICS_FAILURES_LEFT__ = 0;
      window.localStorage.setItem('yut-online:activeRoomId', 'room-a');
    });
    await statisticsButton.click();
    await page.waitForTimeout(5);
    await page.evaluate(() => window.localStorage.setItem('yut-online:activeRoomId', 'room-b'));
    await expect(dialog.getByRole('tab', { name: '새 방' })).toBeVisible({ timeout: 3_000 });
    await expect(dialog.getByRole('tab', { name: '이전 방' })).toHaveCount(0);
    await expect(dialog.getByTestId('game-statistics-record')).toContainText('#3');
    expect(await page.evaluate(() => window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__.slice(-2))).toEqual(['room-a', 'room-b']);
  });
});
