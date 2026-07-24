import { test, expect } from '@playwright/test';
import { createRoomFromLobby, primeLobbyStorage } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('turn-order roll placement and confirmed rank QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('Galaxy 세로 화면에서 순서 정하기 조작부·제한시간·윷 연출과 확정 순서를 검증한다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'turn-order-placement'));
    const roomTitle = makeQaName(testInfo, 'turn-order-placement-room');
    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '3',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도', '도', '걸', '개'];
    });

    await createRoomFromLobby(page, roomTitle);
    roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
    await page.getByTestId('add-ai-P2').click();
    await page.getByTestId('add-ai-P3').click();
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('start-game-button').click();
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

    const rollButton = page.getByTestId('turn-order-roll-button');
    const roundTimer = page.getByTestId('turn-order-round-timer');
    await expect(rollButton).toBeVisible({ timeout: 10_000 });
    await expect(roundTimer).toBeVisible();
    await expect(roundTimer).toHaveClass(/time-limit-bar/);
    await expect(roundTimer).toHaveClass(/turn-action-timer/);
    await expect(page.locator('.turn-order-round-status')).not.toContainText('남은 시간');

    const controlsLayout = await page.getByTestId('turn-order-overlay').evaluate((overlay) => {
      const grid = overlay.querySelector('[data-testid="turn-order-result-grid"]');
      const timing = overlay.querySelector('[data-testid="turn-order-timing-panel"]');
      const cards = grid ? Array.from(grid.querySelectorAll('.turn-order-result-card')) : [];
      if (!(grid instanceof HTMLElement) || !(timing instanceof HTMLElement) || cards.length !== 3) {
        throw new Error('순서 정하기 결과 카드 또는 조작부를 찾지 못했습니다.');
      }
      const gridRect = grid.getBoundingClientRect();
      const timingRect = timing.getBoundingClientRect();
      const lastCardRect = cards[cards.length - 1].getBoundingClientRect();
      return {
        gridBottom: gridRect.bottom,
        lastCardBottom: lastCardRect.bottom,
        timingTop: timingRect.top,
      };
    });
    expect(controlsLayout.timingTop, '타이밍 막대와 윷 던지기 버튼은 결과 카드 그리드 아래에 있어야 합니다.').toBeGreaterThanOrEqual(controlsLayout.gridBottom - 1);
    expect(controlsLayout.timingTop, '타이밍 막대와 윷 던지기 버튼은 마지막 결과 카드 아래에 있어야 합니다.').toBeGreaterThanOrEqual(controlsLayout.lastCardBottom - 1);

    const timerAnimation = await roundTimer.locator('span').evaluate((fill) => {
      const style = getComputedStyle(fill);
      return {
        animationName: style.animationName,
        animationDurationSeconds: Number.parseFloat(style.animationDuration),
        animationDelaySeconds: Number.parseFloat(style.animationDelay),
      };
    });
    expect(timerAnimation.animationName).toContain('turn-action-countdown');
    expect(timerAnimation.animationDurationSeconds).toBeGreaterThanOrEqual(7.9);
    expect(timerAnimation.animationDurationSeconds).toBeLessThanOrEqual(8.1);
    expect(timerAnimation.animationDelaySeconds).toBeLessThanOrEqual(0);
    expect(timerAnimation.animationDelaySeconds).toBeGreaterThan(-8.1);

    const ownResult = page.getByTestId('turn-order-own-result');
    await Promise.all([
      expect(ownResult).toContainText('모'),
      rollButton.click(),
    ]);

    const anchor = page.getByTestId('turn-order-roll-stage-anchor');
    const rollStage = anchor.locator(':scope > .roll-stage');
    const rollMat = page.getByTestId('roll-mat');
    await expect(rollStage).toBeVisible({ timeout: 5_000 });
    await expect(rollMat).toBeVisible();
    const layout = await anchor.evaluate((anchorElement) => {
      const overlay = document.querySelector('[data-testid="turn-order-overlay"]');
      const stage = anchorElement.querySelector(':scope > .roll-stage');
      const mat = stage?.querySelector('[data-testid="roll-mat"]');
      if (!(overlay instanceof HTMLElement)
        || !(stage instanceof HTMLElement)
        || !(mat instanceof HTMLElement)) {
        throw new Error('순서 정하기 윷 연출 위치 기준 요소를 찾지 못했습니다.');
      }
      const centerX = (rect) => rect.left + rect.width / 2;
      const centerY = (rect) => rect.top + rect.height / 2;
      const overlayRect = overlay.getBoundingClientRect();
      const anchorRect = anchorElement.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const matRect = mat.getBoundingClientRect();
      return {
        anchorPosition: getComputedStyle(anchorElement).position,
        anchorTop: anchorRect.top,
        anchorLeft: anchorRect.left,
        anchorRightGap: window.innerWidth - anchorRect.right,
        anchorBottomGap: window.innerHeight - anchorRect.bottom,
        anchorOverlayCenterXOffset: Math.abs(centerX(anchorRect) - centerX(overlayRect)),
        anchorOverlayCenterYOffset: Math.abs(centerY(anchorRect) - centerY(overlayRect)),
        stageAnchorCenterXOffset: Math.abs(centerX(stageRect) - centerX(anchorRect)),
        stageAnchorCenterYOffset: Math.abs(centerY(stageRect) - centerY(anchorRect)),
        matOverlayCenterXOffset: Math.abs(centerX(matRect) - centerX(overlayRect)),
        matOverlayCenterYOffset: Math.abs(centerY(matRect) - centerY(overlayRect)),
        matTop: matRect.top,
        matBottomGap: window.innerHeight - matRect.bottom,
      };
    });
    expect(layout.anchorPosition).toBe('fixed');
    expect(Math.abs(layout.anchorTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.anchorLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.anchorRightGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.anchorBottomGap)).toBeLessThanOrEqual(1);
    expect(layout.anchorOverlayCenterXOffset).toBeLessThanOrEqual(1);
    expect(layout.anchorOverlayCenterYOffset).toBeLessThanOrEqual(1);
    expect(layout.stageAnchorCenterXOffset).toBeLessThanOrEqual(1);
    expect(layout.stageAnchorCenterYOffset).toBeLessThanOrEqual(1);
    expect(layout.matOverlayCenterXOffset).toBeLessThanOrEqual(2);
    expect(layout.matOverlayCenterYOffset).toBeLessThanOrEqual(2);
    expect(layout.matTop, '순서 정하기 윷 매트 위쪽이 화면 밖으로 잘리면 안 됩니다.').toBeGreaterThanOrEqual(-1);
    expect(layout.matBottomGap, '순서 정하기 윷 매트 아래쪽이 화면 밖으로 잘리면 안 됩니다.').toBeGreaterThanOrEqual(-1);

    await expect(page.getByTestId('turn-order-spectating')).toBeVisible({ timeout: 25_000 });
    const ownCard = page.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: nickname });
    await expect(ownCard).toContainText('1번째');
    await expect(ownCard).toContainText('순서 확정');
    await expect(ownCard).not.toContainText('순위 확정');
  });
});
