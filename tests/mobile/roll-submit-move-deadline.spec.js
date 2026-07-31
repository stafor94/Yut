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

      const nativeRandom = Math.random;
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;

        // Perfect consumes the first value for the weighted result. Other grades consume four
        // values for the sticks and the fifth for fall. The first value deterministically resolves to 도.
        const values = [0.1, 0.3, 0.7, 0.7, 0.8];
        let index = 0;
        Math.random = () => values[Math.min(index++, values.length - 1)];
        queueMicrotask(() => {
          Math.random = nativeRandom;
        });
      }, true);
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
      let movedBeforeEnabled = false;
      let enabledAt = 0;
      let timerAt = 0;
      let deadlineAt = 0;
      const sample = () => {
        const moveButton = document.querySelector('[data-testid="move-piece-button"]');
        const timer = document.querySelector('.turn-action-timer');
        const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
        const debug = window.__YUT_DEBUG_STATE__ ?? {};
        const localSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
        const localPieces = Array.isArray(debug.pieces)
          ? debug.pieces.filter((piece) => piece?.ownerId === localSeatId)
          : [];
        if (!moveEnabled && localPieces.some((piece) => piece?.started || piece?.nodeId !== 'n01')) movedBeforeEnabled = true;
        if (!(timer instanceof HTMLElement)) sawConsumedRollTimerDisappear = true;
        if (!enabledAt && moveEnabled) enabledAt = performance.now();
        if (!timerAt && sawConsumedRollTimerDisappear && timer instanceof HTMLElement) {
          timerAt = performance.now();
          deadlineAt = Number(timer.dataset.deadlineAt ?? 0);
        }
        if (enabledAt && timerAt) {
          resolve({ movedBeforeEnabled, enabledAt, timerAt, deadlineAt, observedAt: Date.now() });
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
    expect(ordering.movedBeforeEnabled, 'move action-ready 이전에는 단일 후보 자동 이동이 시작되면 안 됩니다.').toBe(false);
    expect(ordering.timerAt).toBeGreaterThanOrEqual(ordering.enabledAt - 20);
    expect(ordering.timerAt - ordering.enabledAt).toBeLessThanOrEqual(80);
    expect(ordering.deadlineAt - ordering.observedAt).toBeGreaterThanOrEqual(9_700);
    expect(ordering.deadlineAt - ordering.observedAt).toBeLessThanOrEqual(10_050);
    await expect(page.getByTestId('move-piece-button')).toBeEnabled();
    await expect(page.locator('.turn-action-timer')).toBeVisible();

    await expect.poll(async () => {
      const state = await collectScreenState(page);
      const debug = state.yutDebug ?? {};
      const localPieces = Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === debug.localSeatId)
        : [];
      const movedPieces = localPieces.filter((piece) => piece?.started && !piece?.finished);
      return movedPieces.length === 1
        && movedPieces[0]?.nodeId === 'n02'
        && debug.roll == null
        && debug.lastMovedSeatId === debug.localSeatId
        && Array.isArray(debug.lastMovedPieceIds)
        && debug.lastMovedPieceIds.length === 1
        && debug.activeSeat?.id !== debug.localSeatId
        && debug.pendingLocalRemoteActionCount === 0;
    }, { timeout: 15_000, intervals: [50, 100, 200], message: '도 자동 이동은 정확히 한 번 n02에 확정되고 roll을 소비한 뒤 다음 차례로 넘어가야 합니다.' }).toBe(true);

    const settledState = await collectScreenState(page);
    const settledDebug = settledState.yutDebug ?? {};
    const settledLocalPieces = Array.isArray(settledDebug.pieces)
      ? settledDebug.pieces.filter((piece) => piece?.ownerId === settledDebug.localSeatId)
      : [];
    expect(settledLocalPieces.filter((piece) => piece?.started && !piece?.finished).map((piece) => piece.nodeId)).toEqual(['n02']);
    expect(settledLocalPieces.some((piece) => piece?.nodeId === 'n03')).toBe(false);
    expect(settledState.moveButton.disabled).toBe(true);
  });
});
