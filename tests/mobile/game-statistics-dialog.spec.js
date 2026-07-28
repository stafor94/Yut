import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';
import { installGameStatisticsFixture } from '../helpers/game-statistics-fixture.js';

const seats = [
  { id: 'p1', label: 'P1', name: '플레이어하나', color: 'red', team: '청팀', seatIndex: 0 },
  { id: 'p2', label: 'P2', name: '플레이어둘', color: 'blue', team: '홍팀', seatIndex: 1 },
  { id: 'p3', label: 'P3', name: '플레이어셋', color: 'green', team: '청팀', seatIndex: 2 },
  { id: 'ai-4', label: 'P4', name: 'AI 플레이어넷', color: 'yellow', team: '홍팀', seatIndex: 3, isAI: true },
];
const results = ['빽도', '도', '개', '걸', '윷', '모'];
const timings = ['perfect', 'nice', 'good', 'bad'];
const sequences = Array.from({ length: 40 }, (_, index) => ({
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

async function openStatistics(page, viewport) {
  await page.setViewportSize(viewport);
  await expectAppShell(page);
  await installGameStatisticsFixture(page, {
    seats,
    sequences,
    localSeatId: 'p1',
    delayMs: 10,
  });
  await page.getByRole('button', { name: '통계 정보 열기' }).click();
  const dialog = page.getByTestId('game-statistics-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: '플레이어하나' })).toHaveAttribute('aria-selected', 'true');
  return dialog;
}

const readLayout = (page) => page.evaluate(() => {
  const dialogElement = document.querySelector('[data-testid="game-statistics-dialog"]');
  const tabsElement = dialogElement?.querySelector('[role="tablist"]');
  const recordsElement = dialogElement?.querySelector('[data-testid="game-statistics-records"]');
  const footerElement = dialogElement?.querySelector('[data-testid="game-statistics-footer"]');
  const topRow = dialogElement?.querySelector('[data-testid="game-statistics-record-row"]');
  const topCard = topRow?.querySelector('[data-testid="game-statistics-record"]');
  const sequenceBadge = topCard?.querySelector('.game-statistics-sequence-badge');
  const timingBadge = topCard?.querySelector('.game-statistics-badge.timing');
  const yutResult = topCard?.querySelector('.game-statistics-yut-result');
  const timingSection = dialogElement?.querySelector('[aria-label="타이밍 결과 통계"]');
  const timingHeading = timingSection?.querySelector('h3');
  const timingGrid = timingSection?.querySelector('.game-statistics-summary-grid');
  const yutSection = dialogElement?.querySelector('[aria-label="윷 결과 통계"]');
  const yutHeading = yutSection?.querySelector('h3');
  const yutGrid = yutSection?.querySelector('.game-statistics-summary-grid');
  const timingCards = timingGrid?.querySelectorAll(':scope > p');
  const captureCount = dialogElement?.querySelector('[data-testid="game-statistics-capture-count"]');
  const closeButton = dialogElement?.querySelector('.modal-actions button');
  if (!(dialogElement instanceof HTMLElement)
    || !(tabsElement instanceof HTMLElement)
    || !(recordsElement instanceof HTMLElement)
    || !(footerElement instanceof HTMLElement)
    || !(topRow instanceof HTMLElement)
    || !(topCard instanceof HTMLElement)
    || !(sequenceBadge instanceof HTMLElement)
    || !(timingBadge instanceof HTMLElement)
    || !(yutResult instanceof HTMLElement)
    || !(timingHeading instanceof HTMLElement)
    || !(timingGrid instanceof HTMLElement)
    || !(yutHeading instanceof HTMLElement)
    || !(yutGrid instanceof HTMLElement)
    || !(captureCount instanceof HTMLElement)
    || !(closeButton instanceof HTMLElement)
    || !timingCards) {
    throw new Error('통계 정보 모바일 레이아웃을 찾지 못했습니다.');
  }
  const dialogBox = dialogElement.getBoundingClientRect();
  const recordsBox = recordsElement.getBoundingClientRect();
  const footerBox = footerElement.getBoundingClientRect();
  const rowBox = topRow.getBoundingClientRect();
  const cardBox = topCard.getBoundingClientRect();
  const sequenceBox = sequenceBadge.getBoundingClientRect();
  const timingBox = timingBadge.getBoundingClientRect();
  const yutBox = yutResult.getBoundingClientRect();
  const timingHeadingBox = timingHeading.getBoundingClientRect();
  const timingGridBox = timingGrid.getBoundingClientRect();
  const yutHeadingBox = yutHeading.getBoundingClientRect();
  const yutGridBox = yutGrid.getBoundingClientRect();
  const captureBox = captureCount.getBoundingClientRect();
  const closeBox = closeButton.getBoundingClientRect();
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentScrollHeight: document.documentElement.scrollHeight,
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
    recordsBottom: recordsBox.bottom,
    rowColumnCount: getComputedStyle(topRow).gridTemplateColumns.split(' ').filter(Boolean).length,
    rowLeft: rowBox.left,
    firstCardLeft: cardBox.left,
    sequenceTop: sequenceBox.top,
    sequenceBottom: sequenceBox.bottom,
    cardTop: cardBox.top,
    timingWidth: timingBox.width,
    timingHeight: timingBox.height,
    timingRight: timingBox.right,
    yutLeft: yutBox.left,
    footerTop: footerBox.top,
    footerBottom: footerBox.bottom,
    recordsToTimingTitleGap: timingHeadingBox.top - recordsBox.bottom,
    timingTitleToCardsGap: timingGridBox.top - timingHeadingBox.bottom,
    timingToYutGap: yutHeadingBox.top - timingGridBox.bottom,
    yutTitleToCardsGap: yutGridBox.top - yutHeadingBox.bottom,
    yutToCaptureGap: captureBox.top - yutGridBox.bottom,
    captureToCloseGap: closeBox.top - captureBox.bottom,
    closeToDialogBottomGap: dialogBox.bottom - closeBox.bottom,
    timingCardTops: Array.from(timingCards).map((card) => Math.round(card.getBoundingClientRect().top)),
    timingCardCount: timingCards.length,
  };
});

test.describe('통계 정보 모바일 레이아웃', () => {
  test('412×915에서 6열 부분 행을 좌측 정렬하고 기록 영역만 스크롤한다', async ({ page }) => {
    const dialog = await openStatistics(page, { width: 412, height: 915 });
    const tabs = dialog.getByRole('tablist', { name: '플레이어 통계' });
    const records = dialog.getByTestId('game-statistics-records');
    const footer = dialog.getByTestId('game-statistics-footer');
    const heading = dialog.getByRole('heading', { name: '통계 정보' });
    const rows = dialog.getByTestId('game-statistics-record-row');
    await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
    await expect(rows).toHaveCount(7);

    const topRecords = rows.nth(0).getByTestId('game-statistics-record');
    await expect(topRecords).toHaveCount(4);
    expect(await topRecords.evaluateAll((cards) => cards.map((card) => card.querySelector('.game-statistics-sequence-badge')?.textContent))).toEqual([
      '#37', '#38', '#39', '#40',
    ]);
    expect(await rows.nth(1).getByTestId('game-statistics-record').evaluateAll((cards) => cards.map((card) => card.querySelector('.game-statistics-sequence-badge')?.textContent))).toEqual([
      '#31', '#32', '#33', '#34', '#35', '#36',
    ]);

    const layout = await readLayout(page);
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
    expect(layout.rowColumnCount).toBe(6);
    expect(Math.abs(layout.firstCardLeft - layout.rowLeft)).toBeLessThanOrEqual(1);
    expect(layout.sequenceTop).toBeGreaterThanOrEqual(layout.recordsTop);
    expect(layout.sequenceTop).toBeLessThan(layout.cardTop);
    expect(layout.sequenceBottom).toBeGreaterThan(layout.cardTop);
    expect(Math.abs(layout.timingWidth - layout.timingHeight)).toBeLessThanOrEqual(1);
    expect(layout.yutLeft).toBeGreaterThanOrEqual(layout.timingRight);
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.recordsBottom);
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.dialogBottom);
    expect(layout.timingCardCount).toBe(4);
    expect(new Set(layout.timingCardTops).size).toBe(1);
    expect(layout.recordsToTimingTitleGap).toBeGreaterThanOrEqual(8);
    expect(layout.timingTitleToCardsGap).toBeGreaterThanOrEqual(5);
    expect(layout.timingToYutGap).toBeGreaterThanOrEqual(8);
    expect(layout.yutTitleToCardsGap).toBeGreaterThanOrEqual(5);
    expect(layout.yutToCaptureGap).toBeGreaterThanOrEqual(8);
    expect(layout.captureToCloseGap).toBeGreaterThanOrEqual(10);
    expect(layout.closeToDialogBottomGap).toBeGreaterThanOrEqual(8);
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

  test('412×700 compact 화면에서도 footer와 닫기 버튼이 잘리지 않고 핵심 간격을 유지한다', async ({ page }) => {
    const dialog = await openStatistics(page, { width: 412, height: 700 });
    const layout = await readLayout(page);
    expect(layout.dialogTop).toBeGreaterThanOrEqual(0);
    expect(layout.dialogBottom).toBeLessThanOrEqual(layout.viewportHeight);
    expect(layout.dialogScrollHeight).toBeLessThanOrEqual(layout.dialogClientHeight + 1);
    expect(layout.recordScrollHeight).toBeGreaterThan(layout.recordClientHeight);
    expect(layout.recordOverflowY).toBe('auto');
    expect(layout.recordsToTimingTitleGap).toBeGreaterThanOrEqual(6);
    expect(layout.timingTitleToCardsGap).toBeGreaterThanOrEqual(6);
    expect(layout.timingToYutGap).toBeGreaterThanOrEqual(6);
    expect(layout.yutTitleToCardsGap).toBeGreaterThanOrEqual(6);
    expect(layout.yutToCaptureGap).toBeGreaterThanOrEqual(6);
    expect(layout.captureToCloseGap).toBeGreaterThanOrEqual(6);
    expect(layout.closeToDialogBottomGap).toBeGreaterThanOrEqual(6);
    await expect(dialog.getByTestId('game-statistics-capture-count')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  });
});
