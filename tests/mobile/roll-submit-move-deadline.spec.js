import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa } from '../helpers/rooms.js';

test.describe('Galaxy roll submit and move deadline presentation contract', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('제출 즉시 기존 roll timer를 종료하고 move 버튼 활성화 프레임부터 전체 제한시간을 시작한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(120_000);
    await page.setViewportSize({ width: 412, height: 915 });

    const hostName = normalizeQaNickname(makeQaName(testInfo, 'presentation-host'));
    const roomTitle = makeQaName(testInfo, 'presentation-room');
    await primeLobbyStorage(context, {
      nickname: hostName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      stackedRollMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
      window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 50;
      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;
    });

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await page.getByTestId('add-ai-P2').click();
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('start-game-button').click();
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const state = await collectScreenState(page);
      const debug = state.yutDebug ?? {};
      return Array.isArray(debug.turnOrderIds)
        && debug.turnOrderIds.length === 2
        && !debug.turnOrderPhase?.active
        && !debug.turnOrderIntro
        && state.rollButton.visible
        && !state.rollButton.disabled;
    }, { timeout: 45_000, message: '첫 roll action이 가능한 상태여야 합니다.' }).toBe(true);

    await expect(page.locator('.turn-action-timer')).toBeVisible();
    await expect(page.locator('.roll-timing-live-meter')).toBeVisible();

    const orderingPromise = page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let sawConsumedRollTimerDisappear = false;
      let enabledAt = 0;
      let timerAt = 0;
      let deadlineAt = 0;
      const sample = () => {
        const moveButton = document.querySelector('[data-testid="move-piece-button"]');
        const timer = document.querySelector('.turn-action-timer');
        if (!(timer instanceof HTMLElement)) sawConsumedRollTimerDisappear = true;
        if (!enabledAt && moveButton instanceof HTMLButtonElement && !moveButton.disabled) enabledAt = performance.now();
        if (!timerAt && sawConsumedRollTimerDisappear && timer instanceof HTMLElement) {
          timerAt = performance.now();
          deadlineAt = Number(timer.dataset.deadlineAt ?? 0);
        }
        if (enabledAt && timerAt) {
          resolve({ enabledAt, timerAt, deadlineAt, observedAt: Date.now() });
          return;
        }
        if (performance.now() - startedAt > 30_000) {
          reject(new Error('소비된 roll timer 제거 후 move 버튼 활성화와 새 timer 최초 표시를 관찰하지 못했습니다.'));
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));

    await page.getByTestId('roll-yut-button').evaluate((button) => button.click());
    await expect(page.locator('.turn-action-timer')).toHaveCount(0, { timeout: 500 });
    await expect(page.locator('.roll-timing-live-meter')).toHaveCount(0, { timeout: 500 });

    const stayedHiddenDuringDelayedCommit = await page.evaluate(async () => {
      const observeFrom = performance.now() + 100;
      const observeUntil = performance.now() + 2_700;
      while (performance.now() < observeUntil) {
        if (performance.now() >= observeFrom
          && (document.querySelector('.turn-action-timer') || document.querySelector('.roll-timing-live-meter'))) return false;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return true;
    });
    expect(stayedHiddenDuringDelayedCommit, 'authoritative 응답 지연 중 소비된 roll timer/meter가 다시 나타나면 안 됩니다.').toBe(true);

    await expect(page.locator('.roll-stage')).toBeVisible({ timeout: 10_000 });
    const ordering = await orderingPromise;
    expect(ordering.timerAt).toBeGreaterThanOrEqual(ordering.enabledAt - 20);
    expect(ordering.timerAt - ordering.enabledAt).toBeLessThanOrEqual(80);
    expect(ordering.deadlineAt - ordering.observedAt).toBeGreaterThanOrEqual(9_700);
    expect(ordering.deadlineAt - ordering.observedAt).toBeLessThanOrEqual(10_050);
    await expect(page.getByTestId('move-piece-button')).toBeEnabled();
    await expect(page.locator('.turn-action-timer')).toBeVisible();
  });
});
