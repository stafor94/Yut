import { test, expect } from '@playwright/test';
import {
  collectScreenState,
  createRoomFromLobby,
  joinRoomFromLobby,
  markGuestReady,
  primeLobbyStorage,
} from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa } from '../helpers/rooms.js';
import { seedRoomPieceAtNodeForQa } from '../helpers/room-state-fixture.js';

async function installDeterministicHumanClient(context, { turnOrderResult, moveResultDelayMs = 0 }) {
  await context.addInitScript(({ queuedTurnOrderResult, configuredMoveResultDelayMs }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;
    window.__YUT_QA_DELAY_MOVE_PIECE_ACTION_MS__ = configuredMoveResultDelayMs;
    window.localStorage.setItem('yut-online:stackedRollMode', 'false');

    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (document.querySelector('.turn-order-overlay')) return;
      Math.random = () => 0.6;
      queueMicrotask(() => {
        Math.random = nativeRandom;
      });
    }, true);

    const submitTurnOrderWhenReady = () => {
      if (!document.querySelector('.turn-order-overlay')) return;
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (button instanceof HTMLButtonElement && !button.disabled) button.click();
    };
    const observer = new MutationObserver(submitTurnOrderWhenReady);
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    window.addEventListener('load', submitTurnOrderWhenReady);
  }, { queuedTurnOrderResult: turnOrderResult, configuredMoveResultDelayMs: moveResultDelayMs });
}

async function waitForGameReady(page, { expectRollEnabled = false } = {}) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    const turnOrderReady = Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro;
    return turnOrderReady && (!expectRollEnabled || (state.rollButton.visible && !state.rollButton.disabled));
  }, { timeout: 50_000, message: '두 실제 플레이어의 순서 결정이 끝나고 첫 turn action이 가능해야 합니다.' }).toBe(true);
}

async function openTwoHumanGulGame({
  browser,
  hostPage,
  hostContext,
  testInfo,
  suffix,
  executorRole,
  moveResultDelayMs = 0,
  pieceCount = 1,
}) {
  await hostPage.setViewportSize({ width: 412, height: 915 });
  const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestPage = await guestContext.newPage();
  const hostName = normalizeQaNickname(makeQaName(testInfo, `${suffix}-host`));
  const guestName = normalizeQaNickname(makeQaName(testInfo, `${suffix}-guest`));
  const roomTitle = makeQaName(testInfo, `${suffix}-room`);

  await primeLobbyStorage(hostContext, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: String(pieceCount),
  });
  await primeLobbyStorage(guestContext, {
    nickname: guestName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: String(pieceCount),
  });
  await installDeterministicHumanClient(hostContext, {
    turnOrderResult: executorRole === 'host' ? '모' : '도',
    moveResultDelayMs: executorRole === 'host' ? moveResultDelayMs : 0,
  });
  await installDeterministicHumanClient(guestContext, {
    turnOrderResult: executorRole === 'guest' ? '모' : '도',
    moveResultDelayMs: executorRole === 'guest' ? moveResultDelayMs : 0,
  });

  await createRoomFromLobby(hostPage, roomTitle);
  const roomId = await waitForRoomQaAccess(hostPage, { roomTitle });
  await joinRoomFromLobby(guestPage, roomTitle);
  await markGuestReady(guestPage);
  await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
  await hostPage.getByTestId('start-game-button').click();

  const executorPage = executorRole === 'host' ? hostPage : guestPage;
  const observerPage = executorRole === 'host' ? guestPage : hostPage;
  await Promise.all([
    waitForGameReady(executorPage, { expectRollEnabled: true }),
    waitForGameReady(observerPage),
  ]);
  return { roomId, hostPage, guestContext, guestPage, executorPage, observerPage };
}

async function getExecutorPieceIdentity(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const ownerSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const piece = Array.isArray(debug.pieces)
      ? debug.pieces.find((candidate) => candidate?.ownerId === ownerSeatId)
      : null;
    return { ownerSeatId, pieceId: typeof piece?.id === 'string' ? piece.id : '' };
  });
}

async function waitForPieceNode(page, pieceId, nodeId) {
  await expect.poll(() => page.evaluate(({ trackedPieceId, expectedNodeId }) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    return Array.isArray(debug.pieces)
      ? debug.pieces.find((piece) => piece?.id === trackedPieceId)?.nodeId === expectedNodeId
      : false;
  }, { trackedPieceId: pieceId, expectedNodeId: nodeId }), {
    timeout: 15_000,
    message: `${pieceId} 말이 ${nodeId} fixture 상태로 동기화되어야 합니다.`,
  }).toBe(true);
}

async function refreshRoomFixtureState(page, roomId) {
  await page.evaluate((activeRoomId) => {
    window.dispatchEvent(new CustomEvent('yut:sequence-hard-recovery', {
      detail: {
        roomId: activeRoomId,
        watchKey: `${activeRoomId}:qa-fixture`,
        elapsedMs: 0,
      },
    }));
  }, roomId);
}

async function submitPerfectGul(page, {
  clickMoveWhenReady = false,
  trackedPieceId,
  initialNodeId,
} = {}) {
  const orderingPromise = page.evaluate(({ shouldClickMoveWhenReady, targetPieceId, expectedInitialNodeId }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let movedBeforeEnabled = false;
    let moveTimerVisibleBeforeEnabled = false;
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
      const trackedPiece = Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.id === targetPieceId)
        : null;
      if (!moveEnabled && trackedPiece
        && (trackedPiece.nodeId !== expectedInitialNodeId || debug.movingPieceId === targetPieceId)) {
        movedBeforeEnabled = true;
      }
      const resolvedRollVisible = Number(debug.rollResultReadyAt ?? 0) > 0;
      if (!moveEnabled && resolvedRollVisible && document.querySelector('.turn-action-timer')) {
        moveTimerVisibleBeforeEnabled = true;
      }
      if (moveEnabled) {
        const enabledAt = Date.now();
        if (shouldClickMoveWhenReady && moveButton instanceof HTMLButtonElement) moveButton.click();
        resolve({
          movedBeforeEnabled,
          moveTimerVisibleBeforeEnabled,
          enabledAt,
          rollResultReadyAt: Number(debug.rollResultReadyAt ?? 0),
          effectiveRollResultReadyAt: Number(debug.effectiveRollResultReadyAt ?? 0),
        });
        return;
      }
      if (performance.now() - startedAt > 30_000) {
        reject(new Error('걸 결과 뒤 move action-ready 상태를 관찰하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), {
    shouldClickMoveWhenReady: clickMoveWhenReady,
    targetPieceId: trackedPieceId,
    expectedInitialNodeId: initialNodeId,
  });

  const submittedAt = await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const submitInPerfectZone = () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const positionPercent = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && positionPercent >= 45 && positionPercent <= 55) {
        const clickedAt = Date.now();
        button.click();
        resolve(clickedAt);
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
  return { orderingPromise, submittedAt };
}

function observeMoveUntilStable(page, {
  ownerSeatId,
  pieceId,
  initialNodeId,
  expectedPath,
  finalNodeId,
  collectLocalMutationIds,
}) {
  return page.evaluate((input) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let lastCanonicalNodeId = input.initialNodeId;
    let lastRenderedNodeId = input.initialNodeId;
    let settledAt = 0;
    let movingPieceActive = false;
    let movingPieceStartCount = 0;
    const canonicalNodeTransitions = [];
    const renderedNodeTransitions = [];
    const moveActionIds = new Set();

    const getRenderedNodeId = () => {
      const pieceElement = document.querySelector(`[data-testid="piece-${input.pieceId}"]`);
      if (!(pieceElement instanceof HTMLElement)) return 'off-board';
      if (pieceElement.classList.contains('off-board')) return 'n01';
      const nodeElement = [...document.querySelectorAll('[data-testid^="board-node-"]')]
        .find((candidate) => candidate instanceof HTMLElement
          && candidate.style.left === pieceElement.style.left
          && candidate.style.top === pieceElement.style.top);
      return nodeElement?.getAttribute('data-testid')?.replace('board-node-', '') ?? 'off-board';
    };

    const recordTransition = (transitions, previousNodeId, nextNodeId) => {
      const normalized = typeof nextNodeId === 'string' && nextNodeId ? nextNodeId : 'off-board';
      if (normalized !== previousNodeId) transitions.push(normalized);
      return normalized;
    };

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const trackedPiece = Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.id === input.pieceId && piece?.ownerId === input.ownerSeatId)
        : null;
      lastCanonicalNodeId = recordTransition(canonicalNodeTransitions, lastCanonicalNodeId, trackedPiece?.nodeId);
      lastRenderedNodeId = recordTransition(renderedNodeTransitions, lastRenderedNodeId, getRenderedNodeId());

      const movingNow = debug.movingPieceId === input.pieceId;
      if (movingNow && !movingPieceActive) movingPieceStartCount += 1;
      movingPieceActive = movingNow;
      if (input.collectLocalMutationIds) {
        const ids = Array.isArray(debug.actionPipeline?.localClientMutationIds)
          ? debug.actionPipeline.localClientMutationIds.filter((id) => id.startsWith(`move_piece:${input.ownerSeatId}:`))
          : [];
        ids.forEach((id) => moveActionIds.add(id));
      }

      const settled = trackedPiece?.nodeId === input.finalNodeId
        && lastRenderedNodeId === input.finalNodeId
        && !movingNow
        && (!input.collectLocalMutationIds || debug.pendingLocalRemoteActionCount === 0);
      if (settled && !settledAt) settledAt = performance.now();
      if (settledAt && performance.now() - settledAt >= 2_500) {
        resolve({
          canonicalNodeTransitions,
          renderedNodeTransitions,
          moveActionIds: [...moveActionIds],
          finalCanonicalNodeId: trackedPiece?.nodeId ?? '',
          finalRenderedNodeId: lastRenderedNodeId,
          movingPieceStartCount,
          winner: debug.winner ?? null,
          gameEndMode: debug.gameEndMode ?? null,
          pendingLocalRemoteActionCount: Number(debug.pendingLocalRemoteActionCount ?? 0),
          roll: debug.roll ?? null,
        });
        return;
      }
      if (performance.now() - startedAt > 45_000) {
        reject(new Error(`이동이 ${input.finalNodeId}에 한 번 정착하지 못했습니다: ${JSON.stringify({ canonicalNodeTransitions, renderedNodeTransitions, movingPieceStartCount, finalCanonicalNodeId: trackedPiece?.nodeId ?? '', finalRenderedNodeId: lastRenderedNodeId })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), {
    ownerSeatId,
    pieceId,
    initialNodeId,
    expectedPath,
    finalNodeId,
    collectLocalMutationIds,
  });
}

async function expectFastRollPresentationContract(roomId, actorId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const rollSequence = sequences
      .filter((sequence) => sequence?.type === 'roll_yut' && sequence?.actorId === actorId)
      .sort((left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0))[0];
    const clientStartedAt = Number(rollSequence?.action?.payload?.clientActionStartedAt ?? 0);
    const readyAt = Number(rollSequence?.payload?.rollPresentationReadyAt ?? rollSequence?.patch?.rollResultReadyAt ?? 0);
    if (!clientStartedAt || !readyAt) return null;
    return readyAt - clientStartedAt;
  }, {
    timeout: 15_000,
    intervals: [100, 250, 500],
    message: '서버 roll sequence가 clientActionStartedAt 기준 3,200ms readyAt 계약을 기록해야 합니다.',
  }).toBe(3_200);
}

async function expectSingleAuthoritativeMove(roomId, localSeatId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && String(sequence?.clientMutationId ?? '').startsWith(`move_piece:${localSeatId}:`)).length;
  }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(1);
}

function expectSinglePresentation(trace, { expectedPath, finalNodeId, local }) {
  if (local) expect(trace.moveActionIds).toHaveLength(1);
  expect(trace.canonicalNodeTransitions).toEqual(expectedPath);
  expect(trace.renderedNodeTransitions).toEqual(expectedPath);
  expect(trace.movingPieceStartCount).toBe(1);
  expect(trace.finalCanonicalNodeId).toBe(finalNodeId);
  expect(trace.finalRenderedNodeId).toBe(finalNodeId);
  expect(trace.winner).toBeFalsy();
  expect(trace.gameEndMode).toBeFalsy();
  expect(trace.roll).toBeNull();
  if (local) expect(trace.pendingLocalRemoteActionCount).toBe(0);
}

async function runScenario({
  browser,
  page,
  context,
  testInfo,
  suffix,
  executorRole,
  moveResultDelayMs,
  clickMoveWhenReady,
  pieceCount = 1,
  initialNodeId = 'n01',
  previousNodeId = '',
  expectedPath = ['n02', 'n03', 'n04'],
  finalNodeId = 'n04',
}) {
  let game;
  try {
    game = await openTwoHumanGulGame({
      browser,
      hostPage: page,
      hostContext: context,
      testInfo,
      suffix,
      executorRole,
      moveResultDelayMs,
      pieceCount,
    });
    const identity = await getExecutorPieceIdentity(game.executorPage);
    expect(identity.ownerSeatId).not.toBe('');
    expect(identity.pieceId).not.toBe('');

    if (initialNodeId !== 'n01') {
      await seedRoomPieceAtNodeForQa({
        roomId: game.roomId,
        authPage: game.hostPage,
        ownerSeatId: identity.ownerSeatId,
        pieceId: identity.pieceId,
        nodeId: initialNodeId,
        previousNodeId,
      });
      await Promise.all([
        refreshRoomFixtureState(game.executorPage, game.roomId),
        refreshRoomFixtureState(game.observerPage, game.roomId),
      ]);
      await Promise.all([
        waitForPieceNode(game.executorPage, identity.pieceId, initialNodeId),
        waitForPieceNode(game.observerPage, identity.pieceId, initialNodeId),
      ]);
    }

    const localTracePromise = observeMoveUntilStable(game.executorPage, {
      ...identity,
      initialNodeId,
      expectedPath,
      finalNodeId,
      collectLocalMutationIds: true,
    });
    const remoteTracePromise = observeMoveUntilStable(game.observerPage, {
      ...identity,
      initialNodeId,
      expectedPath,
      finalNodeId,
      collectLocalMutationIds: false,
    });
    const submission = await submitPerfectGul(game.executorPage, {
      clickMoveWhenReady,
      trackedPieceId: identity.pieceId,
      initialNodeId,
    });
    const ordering = await submission.orderingPromise;
    expect(ordering.movedBeforeEnabled).toBe(false);
    expect(ordering.moveTimerVisibleBeforeEnabled).toBe(false);
    expect(ordering.rollResultReadyAt).toBeGreaterThan(0);
    expect(ordering.effectiveRollResultReadyAt).toBe(ordering.rollResultReadyAt);
    expect(ordering.enabledAt).toBeGreaterThanOrEqual(ordering.rollResultReadyAt);
    await expectFastRollPresentationContract(game.roomId, identity.ownerSeatId);

    const [localTrace, remoteTrace] = await Promise.all([localTracePromise, remoteTracePromise]);
    expectSinglePresentation(localTrace, { expectedPath, finalNodeId, local: true });
    expectSinglePresentation(remoteTrace, { expectedPath, finalNodeId, local: false });
    await expectSingleAuthoritativeMove(game.roomId, identity.ownerSeatId);
    return game;
  } catch (error) {
    await game?.guestContext.close().catch(() => undefined);
    await deleteRoomForQa(game?.roomId).catch(() => undefined);
    throw error;
  }
}

test.describe('Galaxy online move local ownership contract', () => {
  let roomId;
  let guestContext;

  test.afterEach(async () => {
    await guestContext?.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
    guestContext = undefined;
    roomId = undefined;
  });

  for (const scenario of [
    { name: '빠른 ACK', suffix: 'n16-fast', moveResultDelayMs: 0, clickMoveWhenReady: true },
    { name: '느린 ACK와 수동 클릭 경합', suffix: 'n16-slow-race', moveResultDelayMs: 2_500, clickMoveWhenReady: true },
  ]) {
    test(`n16의 걸 이동은 ${scenario.name}에서도 n17→n18→n19를 한 번만 실행한다`, async ({ browser, page, context }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
      testInfo.setTimeout(150_000);
      const result = await runScenario({
        browser,
        page,
        context,
        testInfo,
        suffix: scenario.suffix,
        executorRole: scenario.moveResultDelayMs ? 'guest' : 'host',
        moveResultDelayMs: scenario.moveResultDelayMs,
        clickMoveWhenReady: scenario.clickMoveWhenReady,
        pieceCount: 4,
        initialNodeId: 'n16',
        previousNodeId: 'n15',
        expectedPath: ['n17', 'n18', 'n19'],
        finalNodeId: 'n19',
      });
      roomId = result.roomId;
      guestContext = result.guestContext;
    });
  }

  test('출발점 자동 이동과 action-ready 순간 수동 클릭이 경합해도 한 번만 실행한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'start-gul-auto-manual-race',
      executorRole: 'guest',
      moveResultDelayMs: 2_500,
      clickMoveWhenReady: true,
    });
    roomId = result.roomId;
    guestContext = result.guestContext;
  });

  test('기존 출발점 n01의 걸 이동은 n02→n03→n04를 유지한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'start-gul',
      executorRole: 'host',
      moveResultDelayMs: 0,
      clickMoveWhenReady: false,
    });
    roomId = result.roomId;
    guestContext = result.guestContext;
  });
});
