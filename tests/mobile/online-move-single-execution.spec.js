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

const SEEDED_ROOM_RELOAD_DEADLINE_MS = 11_000;
const MAX_LOCAL_MOVE_START_DELAY_MS = 1_500;

async function installDeterministicHumanClient(context, { turnOrderResult, moveResultDelayMs = 0, rollRandom = 0.6, stackedRollMode = false, forceWebGLFailure = false }) {
  await context.addInitScript(({ queuedTurnOrderResult, configuredMoveResultDelayMs, configuredRollRandom, configuredStackedRollMode, configuredForceWebGLFailure }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;
    window.__YUT_QA_DELAY_MOVE_PIECE_ACTION_MS__ = configuredMoveResultDelayMs;
    window.localStorage.setItem('yut-online:stackedRollMode', configuredStackedRollMode ? 'true' : 'false');
    if (configuredForceWebGLFailure) HTMLCanvasElement.prototype.getContext = () => null;

    const nativeRandom = Math.random;
    const rollRandomQueue = Array.isArray(configuredRollRandom) ? [...configuredRollRandom] : [configuredRollRandom];
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (document.querySelector('.turn-order-overlay')) return;
      const nextRollRandom = rollRandomQueue.shift() ?? configuredRollRandom;
      Math.random = () => Array.isArray(nextRollRandom) ? nextRollRandom[0] : nextRollRandom;
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
  }, { queuedTurnOrderResult: turnOrderResult, configuredMoveResultDelayMs: moveResultDelayMs, configuredRollRandom: rollRandom, configuredStackedRollMode: stackedRollMode, configuredForceWebGLFailure: forceWebGLFailure });
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
  rollRandom = 0.6,
  stackedRollMode = false,
  forceWebGLFailure = false,
}) {
  await hostPage.setViewportSize({ width: 412, height: 915 });
  const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestPage = await guestContext.newPage();
  let roomId = '';

  try {
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
      rollRandom,
      stackedRollMode,
      forceWebGLFailure: executorRole === 'host' && forceWebGLFailure,
    });
    await installDeterministicHumanClient(guestContext, {
      turnOrderResult: executorRole === 'guest' ? '모' : '도',
      moveResultDelayMs: executorRole === 'guest' ? moveResultDelayMs : 0,
      rollRandom,
      stackedRollMode,
      forceWebGLFailure: executorRole === 'guest' && forceWebGLFailure,
    });

    await createRoomFromLobby(hostPage, roomTitle);
    roomId = await waitForRoomQaAccess(hostPage, { roomTitle });
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
  } catch (error) {
    await guestContext.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
    throw error;
  }
}

async function getExecutorPieceIdentity(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const ownerSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const ownedPieces = Array.isArray(debug.pieces)
      ? debug.pieces
        .filter((candidate) => candidate?.ownerId === ownerSeatId)
        .sort((left, right) => String(left?.label ?? '').localeCompare(String(right?.label ?? ''), undefined, { numeric: true }))
      : [];
    const piece = ownedPieces[0] ?? null;
    return {
      ownerSeatId,
      pieceId: typeof piece?.id === 'string' ? piece.id : '',
      pieceLabel: typeof piece?.label === 'string' ? piece.label : '',
      otherPieceIds: ownedPieces.slice(1).map((candidate) => String(candidate?.id ?? '')).filter(Boolean),
    };
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

async function clickPerfectRoll(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const sample = () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const position = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && !button.disabled && position >= 45 && position <= 55) {
        button.click();
        resolve(undefined);
        return;
      }
      if (performance.now() - startedAt > 15_000) reject(new Error('Perfect roll 입력 가능 구간을 찾지 못했습니다.'));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function reloadSeededRoomState(game) {
  await Promise.all([
    game.executorPage.reload(),
    game.observerPage.reload(),
  ]);
  await Promise.all([
    waitForGameReady(game.executorPage, { expectRollEnabled: true }),
    waitForGameReady(game.observerPage),
  ]);
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
    let observedRollResultReadyAt = 0;
    let observedEffectiveRollResultReadyAt = 0;
    let enabledAt = 0;

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
      const trackedPiece = Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.id === targetPieceId)
        : null;
      const rollResultReadyAt = Number(debug.rollResultReadyAt ?? 0);
      const effectiveRollResultReadyAt = Number(debug.effectiveRollResultReadyAt ?? 0);
      if (rollResultReadyAt > 0) observedRollResultReadyAt = rollResultReadyAt;
      if (effectiveRollResultReadyAt > 0) observedEffectiveRollResultReadyAt = effectiveRollResultReadyAt;

      const localMoveStarted = Boolean(trackedPiece
        && (trackedPiece.nodeId !== expectedInitialNodeId || debug.movingPieceId === targetPieceId));
      if (!enabledAt && !moveEnabled && localMoveStarted) {
        movedBeforeEnabled = true;
      }
      if (!enabledAt && !moveEnabled && observedRollResultReadyAt > 0 && document.querySelector('.turn-action-timer')) {
        moveTimerVisibleBeforeEnabled = true;
      }
      if (!enabledAt && moveEnabled) {
        enabledAt = Date.now();
        if (shouldClickMoveWhenReady && moveButton instanceof HTMLButtonElement) moveButton.click();
      }
      if (enabledAt && localMoveStarted) {
        resolve({
          movedBeforeEnabled,
          moveTimerVisibleBeforeEnabled,
          enabledAt,
          localMoveStartDelayMs: Date.now() - enabledAt,
          rollResultReadyAt: observedRollResultReadyAt,
          effectiveRollResultReadyAt: observedEffectiveRollResultReadyAt,
        });
        return;
      }
      if (performance.now() - startedAt > 30_000) {
        const pendingDebug = window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null;
        reject(new Error(`move action-ready 상태를 관찰하지 못했습니다: ${JSON.stringify({
          activeSeat: debug.activeSeat,
          localSeatId: debug.localSeatId,
          isMyTurn: debug.isMyTurn,
          pieces: debug.pieces,
          selectedPieceId: debug.selectedPieceId,
          activeMovablePiece: debug.activeMovablePiece,
          canMoveSelectedPiece: debug.canMoveSelectedPiece,
          canSubmitTurnAction: debug.canSubmitTurnAction,
          canRequestMove: debug.canRequestMove,
          hasPendingGameStateSave: debug.hasPendingGameStateSave,
          coordinatorStateSaveKey: debug.coordinatorStateSaveKey,
          turnActionBlockReasons: debug.turnActionBlockReasons,
          moveActionBlockReasons: debug.moveActionBlockReasons,
          turnHealth: debug.turnHealth,
          pendingLocalRemoteActionCount: debug.pendingLocalRemoteActionCount,
          pendingLocalRemoteActions: debug.actionPipeline?.pendingLocalRemoteActions,
          pendingRemoteActionGate: pendingDebug,
          roll: debug.roll,
          rollResultHolding: debug.rollResultHolding,
          rollInProgress: debug.rollInProgress,
          movingPieceId: debug.movingPieceId,
          turnDeadlineKind: debug.turnDeadlineKind,
          turnDeadlineAt: debug.turnDeadlineAt,
          rollResultReadyAt: debug.rollResultReadyAt,
          effectiveRollResultReadyAt: debug.effectiveRollResultReadyAt,
        })}`));
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
    finalNodeId,
    collectLocalMutationIds,
  });
}

async function expectDelayedRollPresentationContract(roomId, actorId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const rollSequence = sequences
      .filter((sequence) => sequence?.type === 'roll_yut' && sequence?.actorId === actorId)
      .sort((left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0))[0];
    const clientStartedAt = Number(rollSequence?.action?.payload?.clientActionStartedAt ?? 0);
    const clientCreatedAt = Number(rollSequence?.clientCreatedAt ?? 0);
    const payloadReadyAt = Number(rollSequence?.payload?.rollPresentationReadyAt ?? 0);
    const patchReadyAt = Number(rollSequence?.patch?.rollResultReadyAt ?? 0);
    const deadlineAt = Number(rollSequence?.patch?.turnDeadlineAt ?? 0);
    if (!clientStartedAt || !clientCreatedAt || !payloadReadyAt || !patchReadyAt || !deadlineAt) return false;

    const delayedSubmissionMs = clientCreatedAt - clientStartedAt;
    const remainingPresentationMs = payloadReadyAt - clientCreatedAt;
    return delayedSubmissionMs >= 3_000
      && remainingPresentationMs >= 2_000
      && remainingPresentationMs <= 3_700
      && patchReadyAt === payloadReadyAt
      && deadlineAt - payloadReadyAt === 10_000;
  }, {
    timeout: 15_000,
    intervals: [100, 250, 500],
    message: '지연 응답 뒤 다음 extra-spin 경계·landing·hold와 10초 move deadline 계약이 일치해야 합니다.',
  }).toBe(true);
}

async function expectSingleAuthoritativeMove(roomId, localSeatId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && String(sequence?.clientMutationId ?? '').startsWith(`move_piece:${localSeatId}:`)).length;
  }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(1);
}

async function expectAuthoritativeRoll(roomId, localSeatId, expectedName, expectedSteps) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const rollSequence = sequences
      .filter((sequence) => sequence?.type === 'roll_yut' && sequence?.actorId === localSeatId)
      .sort((left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0))[0];
    return {
      name: String(rollSequence?.payload?.rollName ?? rollSequence?.patch?.roll?.name ?? ''),
      steps: Number(rollSequence?.payload?.rollSteps ?? rollSequence?.patch?.roll?.steps ?? NaN),
    };
  }, { timeout: 15_000, intervals: [100, 250, 500] }).toEqual({ name: expectedName, steps: expectedSteps });
}

function expectSinglePresentation(trace, { expectedPath, finalNodeId, local }) {
  if (local) {
    expect(trace.moveActionIds).toHaveLength(1);
    expect(trace.canonicalNodeTransitions).toEqual(expectedPath);
  } else {
    let previousPathIndex = -1;
    for (const nodeId of trace.canonicalNodeTransitions) {
      const pathIndex = expectedPath.indexOf(nodeId);
      expect(pathIndex).toBeGreaterThan(previousPathIndex);
      previousPathIndex = pathIndex;
    }
    expect(trace.canonicalNodeTransitions.at(-1)).toBe(finalNodeId);
  }
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
  rollRandom = 0.6,
  expectedRollName = '걸',
  expectedRollSteps = 3,
  initialNodeId = 'n01',
  previousNodeId = '',
  expectedPath = ['n02', 'n03', 'n04'],
  finalNodeId = 'n04',
}) {
  let game;
  let localTracePromise;
  let remoteTracePromise;

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
      rollRandom,
    });
    const identity = await getExecutorPieceIdentity(game.executorPage);
    expect(identity.ownerSeatId).not.toBe('');
    expect(identity.pieceId).not.toBe('');

    if (initialNodeId !== 'n01') {
      // The fixture is applied after the first roll turn starts. Preserve that turn through
      // the two-page reload so the test still exercises a manual delayed roll, not timeout recovery.
      await seedRoomPieceAtNodeForQa({
        roomId: game.roomId,
        authPage: game.hostPage,
        ownerSeatId: identity.ownerSeatId,
        pieceId: identity.pieceId,
        nodeId: initialNodeId,
        previousNodeId,
        turnDeadlineAt: Date.now() + SEEDED_ROOM_RELOAD_DEADLINE_MS,
      });
      await reloadSeededRoomState(game);
      await Promise.all([
        waitForPieceNode(game.executorPage, identity.pieceId, initialNodeId),
        waitForPieceNode(game.observerPage, identity.pieceId, initialNodeId),
      ]);
    }

    localTracePromise = observeMoveUntilStable(game.executorPage, {
      ...identity,
      initialNodeId,
      finalNodeId,
      collectLocalMutationIds: true,
    });
    remoteTracePromise = observeMoveUntilStable(game.observerPage, {
      ...identity,
      initialNodeId,
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
    expect(ordering.localMoveStartDelayMs).toBeLessThanOrEqual(MAX_LOCAL_MOVE_START_DELAY_MS);
    await expectDelayedRollPresentationContract(game.roomId, identity.ownerSeatId);
    await expectAuthoritativeRoll(game.roomId, identity.ownerSeatId, expectedRollName, expectedRollSteps);

    const [localTrace, remoteTrace] = await Promise.all([localTracePromise, remoteTracePromise]);
    expectSinglePresentation(localTrace, { expectedPath, finalNodeId, local: true });
    expectSinglePresentation(remoteTrace, { expectedPath, finalNodeId, local: false });
    await expectSingleAuthoritativeMove(game.roomId, identity.ownerSeatId);
    return { ...game, identity };
  } catch (error) {
    void localTracePromise?.catch(() => undefined);
    void remoteTracePromise?.catch(() => undefined);
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

  test('출발점에 말 2개가 대기 중인 coordinator의 개는 lowest-label 말을 자동 이동한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'start-two-piece-gae-coordinator-auto',
      executorRole: 'host',
      moveResultDelayMs: 0,
      clickMoveWhenReady: false,
      pieceCount: 2,
      rollRandom: 0.4,
      expectedRollName: '개',
      expectedRollSteps: 2,
      expectedPath: ['n02', 'n03'],
      finalNodeId: 'n03',
    });
    roomId = result.roomId;
    guestContext = result.guestContext;

    expect(result.identity.otherPieceIds).toHaveLength(1);
    const waitingPiece = await result.executorPage.evaluate(({ ownerSeatId, otherPieceId }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.ownerId === ownerSeatId && piece?.id === otherPieceId) ?? null
        : null;
    }, { ownerSeatId: result.identity.ownerSeatId, otherPieceId: result.identity.otherPieceIds[0] });
    expect(waitingPiece).toMatchObject({ nodeId: 'n01', started: false, finished: false });

    await expect.poll(async () => {
      const state = await collectScreenState(result.observerPage);
      return state.rollButton.visible && !state.rollButton.disabled;
    }, { timeout: 15_000, intervals: [100, 250, 500], message: '개 자동 이동 완료 뒤 다음 실제 플레이어의 roll action으로 전환되어야 합니다.' }).toBe(true);
  });

  test('출발점에 말 2개가 대기 중일 때 개는 lowest-label 말을 자동 이동하고 수동 클릭 경합에도 한 번만 실행한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'start-two-piece-gae-auto-manual-race',
      executorRole: 'guest',
      moveResultDelayMs: 2_500,
      clickMoveWhenReady: true,
      pieceCount: 2,
      rollRandom: 0.4,
      expectedRollName: '개',
      expectedRollSteps: 2,
      expectedPath: ['n02', 'n03'],
      finalNodeId: 'n03',
    });
    roomId = result.roomId;
    guestContext = result.guestContext;

    expect(result.identity.otherPieceIds).toHaveLength(1);
    const waitingPiece = await result.executorPage.evaluate(({ ownerSeatId, otherPieceId }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.ownerId === ownerSeatId && piece?.id === otherPieceId) ?? null
        : null;
    }, { ownerSeatId: result.identity.ownerSeatId, otherPieceId: result.identity.otherPieceIds[0] });
    expect(waitingPiece).toMatchObject({ nodeId: 'n01', started: false, finished: false });

    await expect.poll(async () => {
      const state = await collectScreenState(result.observerPage);
      return state.rollButton.visible && !state.rollButton.disabled;
    }, { timeout: 15_000, intervals: [100, 250, 500], message: '개 이동 완료 뒤 다음 실제 플레이어의 roll action으로 전환되어야 합니다.' }).toBe(true);
  });

  test('출발점에 말 2개가 대기 중인 걸은 버튼 클릭 즉시 lowest-label 말의 로컬 이동을 시작한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const result = await runScenario({
      browser,
      page,
      context,
      testInfo,
      suffix: 'start-two-piece-gul-immediate-click',
      executorRole: 'guest',
      moveResultDelayMs: 2_500,
      clickMoveWhenReady: true,
      pieceCount: 2,
    });
    roomId = result.roomId;
    guestContext = result.guestContext;
    expect(result.identity.otherPieceIds).toHaveLength(1);
  });

  test('출발점 WebGL 실패의 [모, 개] 누적 결과는 CSS 완료 뒤 클릭 한 번만 이동한다', async ({ browser, page, context }, testInfo) => {
    testInfo.setTimeout(150_000);
    const game = await openTwoHumanGulGame({
      browser, hostPage: page, hostContext: context, testInfo,
      suffix: 'start-webgl-fallback-stack', executorRole: 'host', pieceCount: 2,
      rollRandom: [0.99, 0.4], stackedRollMode: true, forceWebGLFailure: true,
    });
    roomId = game.roomId;
    guestContext = game.guestContext;
    const identity = await getExecutorPieceIdentity(game.executorPage);
    const baseline = await getRoomSequencesForQa(roomId);

    await clickPerfectRoll(game.executorPage);
    await expect(game.executorPage.locator('.turn-roll-stack-badges')).toContainText('모', { timeout: 20_000 });
    await expect(game.executorPage.getByTestId('roll-yut-button')).toBeEnabled({ timeout: 10_000 });
    await clickPerfectRoll(game.executorPage);

    const scene = game.executorPage.getByTestId('yut-roll-scene');
    await expect(scene).toHaveAttribute('data-renderer', 'fallback', { timeout: 5_000 });
    await expect(game.executorPage.getByTestId('roll-yut-button')).toBeDisabled();
    await expect(game.executorPage.locator('.roll-stage')).toHaveAttribute('data-settle-source', 'css-animation-end', { timeout: 10_000 });
    const picker = game.executorPage.locator('.roll-stack-picker');
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await picker.getByRole('button', { name: '개' }).click();
    const moveButton = game.executorPage.getByTestId('move-piece-button');
    await expect(moveButton).toBeEnabled({ timeout: 5_000 });
    await moveButton.click();

    await expect.poll(async () => (await getRoomSequencesForQa(roomId)).slice(baseline.length)
      .filter((sequence) => sequence.type === 'move_piece_resolved' && sequence.actorId === identity.ownerSeatId).length,
    { timeout: 20_000, message: '사용자 클릭 하나가 move_piece_resolved 하나만 생성해야 합니다.' }).toBe(1);
    await waitForPieceNode(game.executorPage, identity.pieceId, 'n03');
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
