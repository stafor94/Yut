import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa } from '../helpers/rooms.js';

async function openDeterministicGulGame(page, context, testInfo, suffix, { moveResultDelayMs = 0 } = {}) {
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
  await context.addInitScript((configuredMoveResultDelayMs) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;
    window.__YUT_QA_DELAY_MOVE_PIECE_ACTION_MS__ = configuredMoveResultDelayMs;

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
  }, moveResultDelayMs);

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
    let trackedPieceId = '';
    let lastCanonicalNodeId = 'n01';
    let lastRenderedNodeId = 'n01';
    let settledAt = 0;
    let moveEnabledObserved = false;
    let movedBeforeEnabled = false;
    const canonicalNodeTransitions = [];
    const renderedNodeTransitions = [];
    const moveActionIds = new Set();

    const getRenderedNodeId = (pieceId) => {
      if (!pieceId) return '';
      const pieceElement = document.querySelector(`[data-testid="piece-${pieceId}"]`);
      if (!(pieceElement instanceof HTMLElement)) return '';
      if (pieceElement.classList.contains('off-board')) return 'n01';
      const nodeElement = [...document.querySelectorAll('[data-testid^="board-node-"]')]
        .find((candidate) => candidate instanceof HTMLElement
          && candidate.style.left === pieceElement.style.left
          && candidate.style.top === pieceElement.style.top);
      return nodeElement?.getAttribute('data-testid')?.replace('board-node-', '') ?? '';
    };

    const recordTransition = (transitions, previousNodeId, nextNodeId) => {
      if (!nextNodeId || nextNodeId === previousNodeId) return previousNodeId;
      if (nextNodeId !== 'n01') transitions.push(nextNodeId);
      return nextNodeId;
    };

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      if (typeof debug.localSeatId === 'string' && debug.localSeatId) localSeatId = debug.localSeatId;
      const localPieces = Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === localSeatId)
        : [];
      const trackedPiece = localPieces[0];
      if (typeof trackedPiece?.id === 'string' && trackedPiece.id) trackedPieceId = trackedPiece.id;
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
      if (moveEnabled) moveEnabledObserved = true;
      if (!moveEnabledObserved && trackedPiece && (trackedPiece.started || trackedPiece.nodeId !== 'n01')) movedBeforeEnabled = true;

      lastCanonicalNodeId = recordTransition(canonicalNodeTransitions, lastCanonicalNodeId, trackedPiece?.nodeId ?? '');
      const renderedNodeId = getRenderedNodeId(trackedPieceId);
      lastRenderedNodeId = recordTransition(renderedNodeTransitions, lastRenderedNodeId, renderedNodeId);

      const localActionIds = Array.isArray(debug.actionPipeline?.localClientMutationIds)
        ? debug.actionPipeline.localClientMutationIds.filter((actionId) => actionId.startsWith(`move_piece:${localSeatId}:`))
        : [];
      localActionIds.forEach((actionId) => moveActionIds.add(actionId));
      const settled = trackedPiece?.nodeId === 'n04'
        && renderedNodeId === 'n04'
        && debug.activeSeat?.id !== localSeatId
        && debug.pendingLocalRemoteActionCount === 0;
      if (settled && !settledAt) settledAt = performance.now();
      if (settledAt && performance.now() - settledAt >= 2_500) {
        resolve({
          localSeatId,
          canonicalNodeTransitions,
          renderedNodeTransitions,
          moveActionIds: [...moveActionIds],
          finalCanonicalNodeId: trackedPiece?.nodeId ?? '',
          finalRenderedNodeId: renderedNodeId,
          movedBeforeEnabled,
        });
        return;
      }
      if (performance.now() - startedAt > 40_000) {
        reject(new Error(`걸 이동이 canonical·rendered n04에 정착한 뒤 안정 상태를 확인하지 못했습니다: ${JSON.stringify({ canonicalNodeTransitions, renderedNodeTransitions, finalCanonicalNodeId: trackedPiece?.nodeId ?? '', finalRenderedNodeId: renderedNodeId, moveActionIds: [...moveActionIds] })}`));
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
    trace.canonicalNodeTransitions,
    'canonical 말 상태는 최종 위치에서 중간 프레임으로 역행하지 않고 n02→n03→n04로 진행해야 합니다.',
  ).toEqual(['n02', 'n03', 'n04']);
  expect(
    trace.renderedNodeTransitions,
    '실제 GameBoard 말은 n02→n03→n04 경로를 정확히 한 번만 표시해야 합니다.',
  ).toEqual(['n02', 'n03', 'n04']);
  expect(trace.finalCanonicalNodeId, '상대 턴 동기화 뒤 canonical 위치를 유지해야 합니다.').toBe('n04');
  expect(trace.finalRenderedNodeId, '상대 턴 동기화 뒤 실제 렌더링 위치를 유지해야 합니다.').toBe('n04');
}

test.describe('Galaxy online move single-execution contract', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('빠른 서버 응답의 자동 걸 이동을 canonical·rendered 경로와 서버 반영 각각 한 번만 실행한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(120_000);
    roomId = await openDeterministicGulGame(page, context, testInfo, 'auto-fast-gul');
    const tracePromise = observeLocalMoveUntilStable(page);
    const ordering = await submitPerfectGul(page);
    expect(ordering.movedBeforeEnabled).toBe(false);

    const trace = await tracePromise;
    expectSingleGulPresentation(trace);
    await expectSingleAuthoritativeMove(roomId, trace.localSeatId);
  });

  test('로컬 연출보다 늦은 서버 응답의 수동 이동도 같은 단조 경로와 단일 실행을 유지한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(120_000);
    roomId = await openDeterministicGulGame(page, context, testInfo, 'manual-slow-gul', { moveResultDelayMs: 2_500 });
    const tracePromise = observeLocalMoveUntilStable(page);
    const ordering = await submitPerfectGul(page, { clickMoveWhenReady: true });
    expect(ordering.movedBeforeEnabled).toBe(false);

    const trace = await tracePromise;
    expectSingleGulPresentation(trace);
    await expectSingleAuthoritativeMove(roomId, trace.localSeatId);
  });
});
