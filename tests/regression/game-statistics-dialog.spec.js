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

    await dialog.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toBeHidden();
    await statisticsButton.click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__YUT_QA_GAME_STATISTICS_LOADER_CALLS__.length)).toBe(2);
  });

  test('3열 기록은 최신 부분 행을 위쪽 오른쪽에 두고 팝업이 아닌 기록 영역만 스크롤한다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectAppShell(page);
    const sequences = Array.from({ length: 31 }, (_, index) => ({
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
    await expect(rows).toHaveCount(11);

    const topRecord = rows.nth(0).getByTestId('game-statistics-record');
    await expect(topRecord).toHaveCount(1);
    await expect(topRecord).toContainText('#31');
    await expect(topRecord).toHaveCSS('grid-column-start', '3');
    expect(await rows.nth(1).getByTestId('game-statistics-record').evaluateAll((cards) => cards.map((card) => card.textContent))).toEqual([
      '#28B걸',
      '#29P윷',
      '#30N모',
    ]);

    const badgeGeometry = await topRecord.evaluate((card) => {
      const badge = card.querySelector('.game-statistics-sequence-badge');
      if (!(badge instanceof HTMLElement)) throw new Error('Sequence 배지를 찾지 못했습니다.');
      const cardBox = card.getBoundingClientRect();
      const badgeBox = badge.getBoundingClientRect();
      return {
        cardTop: cardBox.top,
        badgeTop: badgeBox.top,
        badgeBottom: badgeBox.bottom,
      };
    });
    expect(badgeGeometry.badgeTop).toBeLessThan(badgeGeometry.cardTop);
    expect(badgeGeometry.badgeBottom).toBeGreaterThan(badgeGeometry.cardTop);

    const timingCards = dialog.locator('[aria-label="타이밍 결과 통계"] .game-statistics-summary-grid.timing > p');
    await expect(timingCards).toHaveCount(4);
    const timingCardTops = await timingCards.evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
    expect(new Set(timingCardTops).size).toBe(1);

    const layout = await dialog.evaluate((element) => {
      const recordsElement = element.querySelector('[data-testid="game-statistics-records"]');
      if (!(recordsElement instanceof HTMLElement)) throw new Error('기록 영역을 찾지 못했습니다.');
      return {
        dialogScrollHeight: element.scrollHeight,
        dialogClientHeight: element.clientHeight,
        recordsScrollHeight: recordsElement.scrollHeight,
        recordsClientHeight: recordsElement.clientHeight,
      };
    });
    expect(layout.dialogScrollHeight).toBeLessThanOrEqual(layout.dialogClientHeight + 1);
    expect(layout.recordsScrollHeight).toBeGreaterThan(layout.recordsClientHeight);

    const headingBefore = await heading.boundingBox();
    const footerBefore = await footer.boundingBox();
    await records.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByTestId('game-statistics-record').last()).toBeInViewport();
    const headingAfter = await heading.boundingBox();
    const footerAfter = await footer.boundingBox();
    expect(Math.abs((headingAfter?.y ?? 0) - (headingBefore?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((footerAfter?.y ?? 0) - (footerBefore?.y ?? 0))).toBeLessThanOrEqual(1);
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
    await expect(dialog.getByRole('tab', { name: '이전 방' })).toHaveAttribute('aria-selected', 'true');
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
