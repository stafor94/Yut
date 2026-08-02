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
      // Perfect 가중치에서 0.6은 걸(3칸)을 확정한다.
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
    pieceCount: '1',
  });
  await primeLobbyStorage(guestContext, {
    nickname: guestName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '1',
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

  return { roomId, guestContext, guestPage, executorPage, observerPage };
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

function observeMoveUntilStable(page, { ownerSeatId, pieceId, collectLocalMutationIds }) {
  return page.evaluate(({ trackedOwnerSeatId, trackedPieceId, shouldCollectLocalMutationIds }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let lastCanonicalNodeId = 'n01';
    let lastRenderedNodeId = 'n01';
    let canonicalMovementStarted = false;
    let renderedMovementStarted = false;
    let settledAt = 0;
    let movingPieceActive = false;
    let movingPieceStartCount = 0;
    let rollClearedAfterMove = false;
    let rollReappearedAfterMove = false;
    const canonicalNodeTransitions = [];
    const renderedNodeTransitions = [];
    const moveActionIds = new Set();

    const normalizeNodeId = (value) => typeof value === 'string' && value ? value : 'off-board';
    const getRenderedNodeId = () => {
      const pieceElement = document.querySelector(`[data-testid="piece-${trackedPieceId}"]`);
      if (!(pieceElement instanceof HTMLElement)) return 'off-board';
      if (pieceElement.classList.contains('off-board')) return 'n01';
      const nodeElement = [...document.querySelectorAll('[data-testid^="board-node-"]')]
        .find((candidate) => candidate instanceof HTMLElement
          && candidate.style.left === pieceElement.style.left
          && candidate.style.top === pieceElement.style.top);
      return nodeElement?.getAttribute('data-testid')?.replace('board-node-', '') ?? 'off-board';
    };

    const recordTransition = (transitions, previousNodeId, nextNodeId, movementStarted) => {
      const normalized = normalizeNodeId(nextNodeId);
      if (normalized === previousNodeId) return { nodeId: previousNodeId, movementStarted };
      const nextMovementStarted = movementStarted || normalized !== 'n01';
      if (nextMovementStarted) transitions.push(normalized);
      return { nodeId: normalized, movementStarted: nextMovementStarted };
    };

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const trackedPiece = Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.id === trackedPieceId && piece?.ownerId === trackedOwnerSeatId)
        : null;
      const canonical = recordTransition(
        canonicalNodeTransitions,
        lastCanonicalNodeId,
        trackedPiece?.nodeId,
        canonicalMovementStarted,
      );
      lastCanonicalNodeId = canonical.nodeId;
      canonicalMovementStarted = canonical.movementStarted;
      const rendered = recordTransition(
        renderedNodeTransitions,
        lastRenderedNodeId,
        getRenderedNodeId(),
        renderedMovementStarted,
      );
      lastRenderedNodeId = rendered.nodeId;
      renderedMovementStarted = rendered.movementStarted;

      const movingNow = debug.movingPieceId === trackedPieceId;
      if (movingNow && !movingPieceActive) movingPieceStartCount += 1;
      movingPieceActive = movingNow;

      if (canonicalMovementStarted && debug.roll == null) rollClearedAfterMove = true;
      if (rollClearedAfterMove && debug.roll != null) rollReappearedAfterMove = true;

      if (shouldCollectLocalMutationIds) {
        const localActionIds = Array.isArray(debug.actionPipeline?.localClientMutationIds)
          ? debug.actionPipeline.localClientMutationIds.filter((actionId) => actionId.startsWith(`move_piece:${trackedOwnerSeatId}:`))
          : [];
        localActionIds.forEach((actionId) => moveActionIds.add(actionId));
      }

      const settled = trackedPiece?.nodeId === 'n04'
        && lastRenderedNodeId === 'n04'
        && !movingNow
        && (!shouldCollectLocalMutationIds || debug.pendingLocalRemoteActionCount === 0);
      if (settled && !settledAt) settledAt = performance.now();
      if (settledAt && performance.now() - settledAt >= 2_500) {
        resolve({
          canonicalNodeTransitions,
          renderedNodeTransitions,
          moveActionIds: [...moveActionIds],
          finalCanonicalNodeId: trackedPiece?.nodeId ?? '',
          finalRenderedNodeId: lastRenderedNodeId,
          movingPieceStartCount,
          rollReappearedAfterMove,
        });
        return;
      }
      if (performance.now() - startedAt > 45_000) {
        reject(new Error(`이동이 양쪽 canonical·DOM n04에 한 번 정착하지 못했습니다: ${JSON.stringify({ canonicalNodeTransitions, renderedNodeTransitions, movingPieceStartCount, finalCanonicalNodeId: trackedPiece?.nodeId ?? '', finalRenderedNodeId: lastRenderedNodeId })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), {
    trackedOwnerSeatId: ownerSeatId,
    trackedPieceId: pieceId,
    shouldCollectLocalMutationIds: collectLocalMutationIds,
  });
}

async function submitNextOpponentRoll(page) {
  const beforeSequence = await page.evaluate(() => Number(window.__YUT_DEBUG_STATE__?.lastAppliedSequence ?? 0));
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    return state.rollButton.visible && !state.rollButton.disabled;
  }, { timeout: 25_000, message: '이동 뒤 상대 플레이어가 다음 roll action을 실행할 수 있어야 합니다.' }).toBe(true);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const submit = () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const positionPercent = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && positionPercent >= 45 && positionPercent <= 55) {
        button.click();
        resolve();
        return;
      }
      if (performance.now() - startedAt > 3_000) {
        reject(new Error('상대 플레이어의 다음 roll action을 제출하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(submit);
    };
    requestAnimationFrame(submit);
  }));
  await expect.poll(() => page.evaluate(() => Number(window.__YUT_DEBUG_STATE__?.lastAppliedSequence ?? 0)), {
    timeout: 20_000,
    message: '상대의 다음 roll action sequence가 적용되어야 합니다.',
  }).toBeGreaterThan(beforeSequence);
}

async function expectPieceAtN04(page, pieceId) {
  await expect.poll(() => page.evaluate((trackedPieceId) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    return Array.isArray(debug.pieces)
      ? debug.pieces.find((piece) => piece?.id === trackedPieceId)?.nodeId ?? ''
      : '';
  }, pieceId), { timeout: 10_000 }).toBe('n04');
}

async function expectSingleAuthoritativeMove(roomId, localSeatId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && String(sequence?.clientMutationId ?? '').startsWith(`move_piece:${localSeatId}:`)).length;
  }, { timeout: 15_000, intervals: [100, 250, 500], message: '로컬 걸 이동은 서버 sequence에 정확히 한 번만 기록되어야 합니다.' }).toBe(1);
}

function expectSingleGulPresentation(trace, { local }) {
  if (local) expect(trace.moveActionIds, '동일한 걸 이동 client mutation은 한 번만 생성되어야 합니다.').toHaveLength(1);
  expect(
    trace.canonicalNodeTransitions,
    'canonical 말 상태는 n01/off-board로 되돌아가지 않고 n02→n03→n04를 한 번만 진행해야 합니다.',
  ).toEqual(['n02', 'n03', 'n04']);
  expect(
    trace.renderedNodeTransitions,
    '실제 GameBoard 말은 n01/off-board로 되돌아가지 않고 n02→n03→n04 경로를 한 번만 표시해야 합니다.',
  ).toEqual(['n02', 'n03', 'n04']);
  expect(trace.movingPieceStartCount, 'movingPieceId는 동일 이동에서 두 번째로 시작되면 안 됩니다.').toBe(1);
  expect(trace.rollReappearedAfterMove, '이동 완료 뒤 윷 결과가 다시 상태에 나타나면 안 됩니다.').toBe(false);
  expect(trace.finalCanonicalNodeId).toBe('n04');
  expect(trace.finalRenderedNodeId).toBe('n04');
}

async function runTwoClientOwnershipScenario({
  browser,
  page,
  context,
  testInfo,
  suffix,
  executorRole,
  moveResultDelayMs,
  clickMoveWhenReady,
}) {
  const game = await openTwoHumanGulGame({
    browser,
    hostPage: page,
    hostContext: context,
    testInfo,
    suffix,
    executorRole,
    moveResultDelayMs,
  });
  const identity = await getExecutorPieceIdentity(game.executorPage);
  expect(identity.ownerSeatId).not.toBe('');
  expect(identity.pieceId).not.toBe('');

  const localTracePromise = observeMoveUntilStable(game.executorPage, {
    ...identity,
    collectLocalMutationIds: true,
  });
  const remoteTracePromise = observeMoveUntilStable(game.observerPage, {
    ...identity,
    collectLocalMutationIds: false,
  });
  const orderingPromise = submitPerfectGul(game.executorPage, { clickMoveWhenReady });
  const ordering = await orderingPromise;
  expect(ordering.movedBeforeEnabled).toBe(false);

  const [localTrace, remoteTrace] = await Promise.all([localTracePromise, remoteTracePromise]);
  expectSingleGulPresentation(localTrace, { local: true });
  expectSingleGulPresentation(remoteTrace, { local: false });
  await expectSingleAuthoritativeMove(game.roomId, identity.ownerSeatId);

  await submitNextOpponentRoll(game.observerPage);
  await Promise.all([
    expectPieceAtN04(game.executorPage, identity.pieceId),
    expectPieceAtN04(game.observerPage, identity.pieceId),
  ]);

  return { ...game, identity };
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

  test('host 이동과 빠른 서버 ACK는 실행 클라이언트에서 재적용하지 않고 guest에 한 번 배포한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runTwoClientOwnershipScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'host-fast-gul',
      executorRole: 'host',
      moveResultDelayMs: 0,
      clickMoveWhenReady: false,
    });
    roomId = result.roomId;
    guestContext = result.guestContext;
  });

  test('guest 이동과 로컬 연출보다 느린 서버 ACK도 양쪽에서 같은 경로를 한 번만 유지한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runTwoClientOwnershipScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'guest-slow-gul',
      executorRole: 'guest',
      moveResultDelayMs: 2_500,
      clickMoveWhenReady: true,
    });
    roomId = result.roomId;
    guestContext = result.guestContext;
  });
});
