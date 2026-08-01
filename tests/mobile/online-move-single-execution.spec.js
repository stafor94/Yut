import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa } from '../helpers/rooms.js';

async function openDeterministicGulGame(page, context, testInfo, suffix) {
  await page.setViewportSize({ width: 412, height: 915 });
  const hostName = normalizeQaNickname(makeQaName(testInfo, `${suffix}-host`));
  const roomTitle = makeQaName(testInfo, `${suffix}-room`);
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
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;

    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      // Perfect 가중치에서 0.6은 걸(3칸)을 확정한다.
      Math.random = () => 0.6;
      queueMicrotask(() => {
        Math.random = nativeRandom;
      });
    }, true);
  });

  await createRoomFromLobby(page, roomTitle);
  const roomId = await waitForRoomQaAccess(page, { roomTitle });
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
  return roomId;
}

async function submitPerfectGul(page, { clickMoveWhenReady = false } = {}) {
  const orderingPromise = page.evaluate((shouldClickMoveWhenReady) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let movedBeforeEnabled = false;
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
      const localSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
      const localPieces = Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === localSeatId)
        : [];
      if (!moveEnabled && localPieces.some((piece) => piece?.started || piece?.nodeId !== 'n01')) movedBeforeEnabled = true;
      if (moveEnabled) {
        if (shouldClickMoveWhenReady && moveButton instanceof HTMLButtonElement) moveButton.click();
        resolve({ movedBeforeEnabled });
        return;
      }
      if (performance.now() - startedAt > 30_000) {
        reject(new Error('걸 결과 뒤 move action-ready 상태를 관찰하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), clickMoveWhenReady);

  const submittedPositionPercent = await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const submitInPerfectZone = () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const positionPercent = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && positionPercent >= 45 && positionPercent <= 55) {
        button.click();
        resolve(positionPercent);
        return;
      }
      if (performance.now() - startedAt > 3_000) {
        reject(new Error('Perfect 구간에서 roll action을 제출하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(submitInPerfectZone);
    };
    requestAnimationFrame(submitInPerfectZone);
  }));
  expect(submittedPositionPercent).toBeGreaterThanOrEqual(45);
  expect(submittedPositionPercent).toBeLessThanOrEqual(55);
  return orderingPromise;
}

function observeLocalMoveUntilStable(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let localSeatId = '';
    let lastNodeId = 'n01';
    let settledAt = 0;
    let moveEnabledObserved = false;
    let movedBeforeEnabled = false;
    const nodeTransitions = [];
    const moveActionIds = new Set();

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      if (typeof debug.localSeatId === 'string' && debug.localSeatId) localSeatId = debug.localSeatId;
      const localPieces = Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === localSeatId)
        : [];
      const trackedPiece = localPieces[0];
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
      if (moveEnabled) moveEnabledObserved = true;
      if (!moveEnabledObserved && trackedPiece && (trackedPiece.started || trackedPiece.nodeId !== 'n01')) movedBeforeEnabled = true;
      if (trackedPiece?.nodeId && trackedPiece.nodeId !== lastNodeId) {
        lastNodeId = trackedPiece.nodeId;
        if (trackedPiece.nodeId !== 'n01') nodeTransitions.push(trackedPiece.nodeId);
      }
      const localActionIds = Array.isArray(debug.actionPipeline?.localClientMutationIds)
        ? debug.actionPipeline.localClientMutationIds.filter((actionId) => actionId.startsWith(`move_piece:${localSeatId}:`))
        : [];
      localActionIds.forEach((actionId) => moveActionIds.add(actionId));
      const settled = trackedPiece?.nodeId === 'n04'
        && debug.activeSeat?.id !== localSeatId
        && debug.pendingLocalRemoteActionCount === 0;
      if (settled && !settledAt) settledAt = performance.now();
      if (settledAt && performance.now() - settledAt >= 2_500) {
        resolve({
          localSeatId,
          nodeTransitions,
          moveActionIds: [...moveActionIds],
          finalNodeId: trackedPiece?.nodeId ?? '',
          movedBeforeEnabled,
        });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error(`걸 이동이 n04에 정착한 뒤 안정 상태를 확인하지 못했습니다: ${JSON.stringify({ nodeTransitions, finalNodeId: trackedPiece?.nodeId ?? '', moveActionIds: [...moveActionIds] })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function expectSingleAuthoritativeMove(roomId, localSeatId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && String(sequence?.clientMutationId ?? '').startsWith(`move_piece:${localSeatId}:`)).length;
  }, { timeout: 15_000, intervals: [100, 250, 500], message: '로컬 걸 이동은 서버 sequence에 정확히 한 번만 기록되어야 합니다.' }).toBe(1);
}

function expectSingleGulPresentation(trace) {
  expect(trace.movedBeforeEnabled, '최종 action-ready 이전에는 낙관적 이동이 시작되면 안 됩니다.').toBe(false);
  expect(trace.moveActionIds, '동일한 걸 이동 client mutation은 한 번만 생성되어야 합니다.').toHaveLength(1);
  expect(
    trace.nodeTransitions,
    '걸 이동은 최종 낙관적 상태 n04를 한 번 반영한 뒤 n02→n03→n04 연출을 한 번만 소비해야 합니다.',
  ).toEqual(['n04', 'n02', 'n03', 'n04']);
  expect(trace.finalNodeId, '상대 턴 동기화 뒤에도 서버의 첫 걸 이동 위치를 유지해야 합니다.').toBe('n04');
}

test.describe('Galaxy online move single-execution contract', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('action-ready 경계의 정상 자동 걸 이동을 요청·낙관적 연출·서버 반영 각각 한 번만 실행한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(120_000);
    roomId = await openDeterministicGulGame(page, context, testInfo, 'auto-gul');
    const tracePromise = observeLocalMoveUntilStable(page);
    const ordering = await submitPerfectGul(page);
    expect(ordering.movedBeforeEnabled).toBe(false);

    const trace = await tracePromise;
    expectSingleGulPresentation(trace);
    await expectSingleAuthoritativeMove(roomId, trace.localSeatId);
  });

  test('수동 이동으로 상태가 바뀌면 이미 예약된 자동 이동 콜백을 취소한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(120_000);
    roomId = await openDeterministicGulGame(page, context, testInfo, 'manual-gul');
    const tracePromise = observeLocalMoveUntilStable(page);
    const ordering = await submitPerfectGul(page, { clickMoveWhenReady: true });
    expect(ordering.movedBeforeEnabled).toBe(false);

    const trace = await tracePromise;
    expectSingleGulPresentation(trace);
    await expectSingleAuthoritativeMove(roomId, trace.localSeatId);
  });
});
