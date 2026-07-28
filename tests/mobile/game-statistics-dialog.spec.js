import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import { installGameStatisticsFixture } from '../helpers/game-statistics-fixture.js';

test('412×915에서 3열 기록만 세로 스크롤되고 헤더·통계·닫기 버튼은 고정된다', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await expectAppShell(page);

  const seats = [
    { id: 'p1', label: 'P1', name: '플레이어하나', color: 'red', team: '청팀', seatIndex: 0 },
    { id: 'p2', label: 'P2', name: '플레이어둘', color: 'blue', team: '홍팀', seatIndex: 1 },
    { id: 'p3', label: 'P3', name: '플레이어셋', color: 'green', team: '청팀', seatIndex: 2 },
    { id: 'ai-4', label: 'P4', name: 'AI 플레이어넷', color: 'yellow', team: '홍팀', seatIndex: 3, isAI: true },
  ];
  const results = ['빽도', '도', '개', '걸', '윷', '모'];
  const timings = ['perfect', 'nice', 'good', 'bad'];
  const sequences = Array.from({ length: 28 }, (_, index) => ({
    id: `mobile-roll-${index + 1}`,
    sequence: index + 1,
    type: 'roll_yut',
    actorId: 'p1',
    payload: {
      timingZone: timings[index % timings.length],
      displayRoll: { name: results[index % results.length], steps: (index % results.length) - 1 },
      fallOccurred: index === 5,
    },
  }));

  await installGameStatisticsFixture(page, {
    seats,
    sequences,
    localSeatId: 'p1',
    delayMs: 10,
  });
  await page.getByRole('button', { name: '통계 정보 열기' }).click();

  const dialog = page.getByTestId('game-statistics-dialog');
  const tabs = dialog.getByRole('tablist', { name: '플레이어 통계' });
  const records = dialog.getByTestId('game-statistics-records');
  const footer = dialog.getByTestId('game-statistics-footer');
  const heading = dialog.getByRole('heading', { name: '통계 정보' });
  const rows = dialog.getByTestId('game-statistics-record-row');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: '플레이어하나' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  await expect(rows).toHaveCount(10);

  const topRecord = rows.nth(0).getByTestId('game-statistics-record');
  await expect(topRecord).toHaveCount(1);
  await expect(topRecord).toContainText('#28');
  await expect(topRecord).toHaveCSS('grid-column-start', '3');
  expect(await rows.nth(1).getByTestId('game-statistics-record').evaluateAll((cards) => cards.map((card) => card.textContent))).toEqual([
    '#25P빽도',
    '#26N도',
    '#27G개',
  ]);

  const layout = await page.evaluate(() => {
    const dialogElement = document.querySelector('[data-testid="game-statistics-dialog"]');
    const tabsElement = dialogElement?.querySelector('[role="tablist"]');
    const recordsElement = dialogElement?.querySelector('[data-testid="game-statistics-records"]');
    const footerElement = dialogElement?.querySelector('[data-testid="game-statistics-footer"]');
    const topCard = dialogElement?.querySelector('[data-testid="game-statistics-record"]');
    const sequenceBadge = topCard?.querySelector('.game-statistics-sequence-badge');
    const timingBadge = topCard?.querySelector('.game-statistics-badge.timing');
    const yutResult = topCard?.querySelector('.game-statistics-yut-result');
    const timingCards = dialogElement?.querySelectorAll('[aria-label="타이밍 결과 통계"] .game-statistics-summary-grid.timing > p');
    const captureCount = dialogElement?.querySelector('[data-testid="game-statistics-capture-count"]');
    const closeButton = dialogElement?.querySelector('.modal-actions button');
    if (!(dialogElement instanceof HTMLElement)
      || !(tabsElement instanceof HTMLElement)
      || !(recordsElement instanceof HTMLElement)
      || !(footerElement instanceof HTMLElement)
      || !(topCard instanceof HTMLElement)
      || !(sequenceBadge instanceof HTMLElement)
      || !(timingBadge instanceof HTMLElement)
      || !(yutResult instanceof HTMLElement)
      || !(captureCount instanceof HTMLElement)
      || !(closeButton instanceof HTMLElement)
      || !timingCards) {
      throw new Error('통계 정보 모바일 레이아웃을 찾지 못했습니다.');
    }
    const dialogBox = dialogElement.getBoundingClientRect();
    const recordsBox = recordsElement.getBoundingClientRect();
    const footerBox = footerElement.getBoundingClientRect();
    const cardBox = topCard.getBoundingClientRect();
    const sequenceBox = sequenceBadge.getBoundingClientRect();
    const timingBox = timingBadge.getBoundingClientRect();
    const yutBox = yutResult.getBoundingClientRect();
    const captureBox = captureCount.getBoundingClientRect();
    const closeBox = closeButton.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      dialogLeft: dialogBox.left,
      dialogTop: dialogBox.top,
      dialogRight: dialogBox.right,
      dialogBottom: dialogBox.bottom,
      dialogScrollWidth: dialogElement.scrollWidth,
      dialogClientWidth: dialogElement.clientWidth,
      dialogScrollHeight: dialogElement.scrollHeight,
      dialogClientHeight: dialogElement.clientHeight,
      tabScrollWidth: tabsElement.scrollWidth,
      tabClientWidth: tabsElement.clientWidth,
      recordScrollHeight: recordsElement.scrollHeight,
      recordClientHeight: recordsElement.clientHeight,
      recordOverflowY: getComputedStyle(recordsElement).overflowY,
      recordsTop: recordsBox.top,
      sequenceTop: sequenceBox.top,
      sequenceBottom: sequenceBox.bottom,
      cardTop: cardBox.top,
      timingWidth: timingBox.width,
      timingHeight: timingBox.height,
      timingRight: timingBox.right,
      yutLeft: yutBox.left,
      footerTop: footerBox.top,
      footerBottom: footerBox.bottom,
      timingCardTops: Array.from(timingCards).map((card) => Math.round(card.getBoundingClientRect().top)),
      timingCardCount: timingCards.length,
      captureToCloseGap: closeBox.top - captureBox.bottom,
    };
  });

  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogTop).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.dialogScrollWidth).toBeLessThanOrEqual(layout.dialogClientWidth + 1);
  expect(layout.dialogScrollHeight).toBeLessThanOrEqual(layout.dialogClientHeight + 1);
  expect(layout.tabScrollWidth).toBeGreaterThan(layout.tabClientWidth);
  expect(layout.recordScrollHeight).toBeGreaterThan(layout.recordClientHeight);
  expect(layout.recordOverflowY).toBe('auto');
  expect(layout.sequenceTop).toBeGreaterThanOrEqual(layout.recordsTop);
  expect(layout.sequenceTop).toBeLessThan(layout.cardTop);
  expect(layout.sequenceBottom).toBeGreaterThan(layout.cardTop);
  expect(Math.abs(layout.timingWidth - layout.timingHeight)).toBeLessThanOrEqual(1);
  expect(layout.yutLeft).toBeGreaterThanOrEqual(layout.timingRight);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.dialogBottom);
  expect(layout.timingCardCount).toBe(4);
  expect(new Set(layout.timingCardTops).size).toBe(1);
  expect(layout.captureToCloseGap).toBeGreaterThanOrEqual(1);
  await expect(dialog.getByText('미확인', { exact: true })).toHaveCount(0);

  const headingBeforeScroll = await heading.boundingBox();
  const footerBeforeScroll = await footer.boundingBox();
  await records.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByTestId('game-statistics-record').last()).toBeInViewport();
  const headingAfterScroll = await heading.boundingBox();
  const footerAfterScroll = await footer.boundingBox();
  expect(Math.abs((headingAfterScroll?.y ?? 0) - (headingBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((footerAfterScroll?.y ?? 0) - (footerBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  await expect(tabs).toBeVisible();
});
