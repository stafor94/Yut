import { test, expect } from '@playwright/test';
import {
  attachConsoleErrorCapture,
  collectScreenState,
  createRoomFromLobby,
  expectNoBlockingConsoleErrors,
  joinRoomFromLobby,
  markGuestReady,
  primeLobbyStorage,
} from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import {
  deleteRoomForQa,
  getRoomSequencesForQa,
  getRoomStateForQa,
} from '../helpers/rooms.js';
import { commitAuthoritativeStatePatchForQa } from '../helpers/authoritative-state-fixture.js';

const MANUAL_COMMIT_DELAY_MS = 8_500;
const FIXTURE_DEADLINE_OFFSET_MS = 6_000;

async function installTwoHumanClient(context, { turnOrderResult, moveCommitDelayMs = 0 }) {
  await context.addInitScript(({ queuedTurnOrderResult, configuredMoveCommitDelayMs }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_DELAY_MOVE_PIECE_COMMIT_AFTER_RESERVATION_MS__ = configuredMoveCommitDelayMs;
    window.localStorage.setItem('yut-online:stackedRollMode', 'true');

    const submitTurnOrderWhenReady = () => {
      if (!document.querySelector('.turn-order-overlay')) return;
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (button instanceof HTMLButtonElement && !button.disabled) button.click();
    };
    const observer = new MutationObserver(submitTurnOrderWhenReady);
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    window.addEventListener('load', submitTurnOrderWhenReady);
  }, {
    queuedTurnOrderResult: turnOrderResult,
    configuredMoveCommitDelayMs: moveCommitDelayMs,
  });
}

async function waitForTwoHumanGameReady(page) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    return Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro;
  }, {
    timeout: 50_000,
    message: '두 실제 플레이어의 순서 결정이 끝나야 합니다.',
  }).toBe(true);
}

async function getLocalPieceIdentity(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const ownerSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const piece = Array.isArray(debug.pieces)
      ? debug.pieces.find((candidate) => candidate?.ownerId === ownerSeatId && !candidate?.finished)
      : null;
    return {
      ownerSeatId,
      pieceId: typeof piece?.id === 'string' ? piece.id : '',
    };
  });
}

function observePieceWithoutRollback(page, { pieceId, finalNodeId, requirePendingClear }) {
  return page.evaluate(({ trackedPieceId, expectedFinalNodeId, shouldRequirePendingClear }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let sawStarted = false;
    let returnedOffBoardAfterStart = false;
    let movingActive = false;
    let movingStartCount = 0;
    let settledAt = 0;
    const nodeTransitions = [];
    let previousNodeId = 'n01';

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const piece = Array.isArray(debug.pieces)
        ? debug.pieces.find((candidate) => candidate?.id === trackedPieceId)
        : null;
      if (piece?.started) sawStarted = true;
      if (sawStarted && piece && !piece.started) returnedOffBoardAfterStart = true;
      const nodeId = typeof piece?.nodeId === 'string' ? piece.nodeId : '';
      if (nodeId && nodeId !== previousNodeId) {
        nodeTransitions.push(nodeId);
        previousNodeId = nodeId;
      }

      const movingNow = debug.movingPieceId === trackedPieceId;
      if (movingNow && !movingActive) movingStartCount += 1;
      movingActive = movingNow;

      const pendingClear = !shouldRequirePendingClear || Number(debug.pendingLocalRemoteActionCount ?? 0) === 0;
      const settled = piece?.started === true
        && nodeId === expectedFinalNodeId
        && !movingNow
        && pendingClear;
      if (settled && !settledAt) settledAt = performance.now();
      if (settledAt && performance.now() - settledAt >= 1_500) {
        resolve({
          nodeTransitions,
          movingStartCount,
          returnedOffBoardAfterStart,
          finalNodeId: nodeId,
          pendingLocalRemoteActionCount: Number(debug.pendingLocalRemoteActionCount ?? 0),
        });
        return;
      }
      if (performance.now() - startedAt > 45_000) {
        reject(new Error(`말이 ${expectedFinalNodeId}에 한 번 정착하지 못했습니다: ${JSON.stringify({ nodeTransitions, movingStartCount, returnedOffBoardAfterStart, nodeId, pending: debug.pendingLocalRemoteActionCount })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), {
    trackedPieceId: pieceId,
    expectedFinalNodeId: finalNodeId,
    shouldRequirePendingClear: requirePendingClear,
  });
}

test.describe('cross-client manual move reservation', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  let roomId = '';
  let guestContext;

  test.afterEach(async () => {
    await guestContext?.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
    guestContext = undefined;
    roomId = '';
  });

  test('비coordinator 플레이어의 deadline 전 윷 이동 reservation이 coordinator timeout 선점을 막는다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 온라인 회귀에서만 실행합니다.');
    await page.setViewportSize({ width: 412, height: 915 });
    guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const guestPage = await guestContext.newPage();
    const hostConsoleErrors = [];
    const guestConsoleErrors = [];
    attachConsoleErrorCapture(page, hostConsoleErrors);
    attachConsoleErrorCapture(guestPage, guestConsoleErrors);

    const hostName = normalizeQaNickname(makeQaName(testInfo, 'reservation-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'reservation-guest'));
    const roomTitle = makeQaName(testInfo, 'manual-timeout-reservation');
    await primeLobbyStorage(context, {
      nickname: hostName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await primeLobbyStorage(guestContext, {
      nickname: guestName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await installTwoHumanClient(context, { turnOrderResult: '도' });
    await installTwoHumanClient(guestContext, { turnOrderResult: '모' });

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await Promise.all([
      waitForTwoHumanGameReady(page),
      waitForTwoHumanGameReady(guestPage),
    ]);

    const hostIdentity = await getLocalPieceIdentity(page);
    const guestIdentity = await getLocalPieceIdentity(guestPage);
    expect(hostIdentity.ownerSeatId).not.toBe('');
    expect(hostIdentity.pieceId).not.toBe('');
    expect(guestIdentity.ownerSeatId).not.toBe('');
    expect(guestIdentity.pieceId).not.toBe('');

    const initialState = await getRoomStateForQa(roomId);
    expect(initialState).not.toBeNull();
    const clients = [
      { page, identity: hostIdentity, role: 'host' },
      { page: guestPage, identity: guestIdentity, role: 'guest' },
    ];
    const coordinatorClient = clients.find((client) => client.identity.ownerSeatId === initialState.coordinatorSeatId);
    const executorClient = clients.find((client) => client.identity.ownerSeatId !== initialState.coordinatorSeatId);
    if (!coordinatorClient || !executorClient) throw new Error('coordinator와 비coordinator executor 브라우저를 구분하지 못했습니다.');
    const coordinatorPage = coordinatorClient.page;
    const executorPage = executorClient.page;
    const coordinatorIdentity = coordinatorClient.identity;
    const executorIdentity = executorClient.identity;
    expect(coordinatorIdentity.ownerSeatId).toBe(initialState.coordinatorSeatId);
    expect(executorIdentity.ownerSeatId).not.toBe(initialState.coordinatorSeatId);
    await executorPage.evaluate((delayMs) => {
      window.__YUT_QA_DELAY_MOVE_PIECE_COMMIT_AFTER_RESERVATION_MS__ = delayMs;
    }, MANUAL_COMMIT_DELAY_MS);

    const executorTurnIndex = initialState.turnOrderIds.findIndex((seatId) => seatId === executorIdentity.ownerSeatId);
    expect(executorTurnIndex).toBeGreaterThanOrEqual(0);
    const executorPiecesOnBoard = initialState.pieces.filter((piece) => (
      piece?.ownerId === executorIdentity.ownerSeatId && piece?.started && !piece?.finished
    ));
    expect(executorPiecesOnBoard).toHaveLength(0);

    const deadlineAt = Date.now() + FIXTURE_DEADLINE_OFFSET_MS;
    const fixture = await commitAuthoritativeStatePatchForQa(page, roomId, {
      turnIndex: executorTurnIndex,
      roll: null,
      rollStack: [
        { name: '윷', steps: 4, bonus: true },
        { name: '개', steps: 2, bonus: false },
      ],
      selectedRollStackIndex: null,
      rollStackClosed: true,
      rollAnimation: null,
      rollResultReadyAt: 0,
      rollLockUntil: 0,
      pendingGoldenYutSelection: null,
      pendingTrapPlacement: null,
      pendingItemPickup: null,
      itemPromptTiming: null,
      branchChoice: 'outer',
      turnDeadlineKind: 'move',
      turnDeadlineAt: deadlineAt,
      turnActionTimeoutCountBySeatId: {
        ...(initialState.turnActionTimeoutCountBySeatId ?? {}),
        [executorIdentity.ownerSeatId]: 0,
      },
      autoPlayBySeatId: {
        ...(initialState.autoPlayBySeatId ?? {}),
        [executorIdentity.ownerSeatId]: false,
      },
    }, executorIdentity.ownerSeatId, {
      fixtureName: 'cross-client-manual-timeout-reservation',
      errorLabel: 'cross-client manual timeout reservation fixture',
    });

    await expect.poll(async () => {
      const current = await getRoomStateForQa(roomId);
      const currentStack = Array.isArray(current?.rollStack) ? current.rollStack : [];
      return Boolean(
        current
        && Number(current.turnVersion) === fixture.turnVersion
        && Number(current.lastSequence) === fixture.lastSequence
        && Number(current.turnIndex) === executorTurnIndex
        && current.roll === null
        && current.rollStackClosed === true
        && current.selectedRollStackIndex === null
        && Number(current.turnDeadlineAt) === deadlineAt
        && current.turnDeadlineKind === 'move'
        && currentStack.length === 2
        && currentStack[0]?.name === '윷'
        && currentStack[1]?.name === '개',
      );
    }, {
      timeout: 4_000,
      intervals: [50, 100, 200, 400],
      message: '윷·개 닫힌 이동 스택 fixture가 authoritative state에 반영되어야 합니다.',
    }).toBe(true);

    await Promise.all([page, guestPage].map((clientPage) => expect.poll(async () => {
      const debug = (await collectScreenState(clientPage)).yutDebug ?? {};
      return Number(debug.lastAppliedSequence ?? 0) === fixture.lastSequence
        && Number(debug.turnIndex ?? -1) === executorTurnIndex
        && Number(debug.turnDeadlineAt ?? 0) === deadlineAt
        && debug.turnDeadlineKind === 'move';
    }, {
      timeout: 4_000,
      intervals: [50, 100, 200, 400],
      message: '두 클라이언트가 동일한 authoritative fixture sequence를 적용해야 합니다.',
    }).toBe(true)));

    const baselineSequences = await getRoomSequencesForQa(roomId);
    const picker = executorPage.locator('.roll-stack-picker');
    await expect(picker).toBeVisible({ timeout: 4_000 });
    const stackButtons = picker.getByRole('button');
    await expect(stackButtons).toHaveCount(2);
    await expect(stackButtons.first()).toHaveText('윷');
    await expect(stackButtons.nth(1)).toHaveText('개');
    await stackButtons.first().click();
    await expect(picker).toBeHidden({ timeout: 2_000 });
    await expect.poll(async () => (await collectScreenState(executorPage)).yutDebug?.selectedPieceId ?? '', {
      timeout: 2_000,
      intervals: [25, 50, 100],
      message: '윷 선택 뒤 executor의 유효한 말이 자동 선택되어야 합니다.',
    }).toBe(executorIdentity.pieceId);

    const executorTracePromise = observePieceWithoutRollback(executorPage, {
      pieceId: executorIdentity.pieceId,
      finalNodeId: 'n05',
      requirePendingClear: true,
    });
    const coordinatorTracePromise = observePieceWithoutRollback(coordinatorPage, {
      pieceId: executorIdentity.pieceId,
      finalNodeId: 'n05',
      requirePendingClear: false,
    });
    await expect(executorPage.getByTestId('move-piece-button')).toBeEnabled({ timeout: 2_000 });
    expect(Date.now()).toBeLessThan(deadlineAt);
    await executorPage.getByTestId('move-piece-button').click();

    const [executorTrace, coordinatorTrace] = await Promise.all([executorTracePromise, coordinatorTracePromise]);
    expect(Date.now()).toBeGreaterThan(deadlineAt);
    expect(executorTrace.returnedOffBoardAfterStart).toBe(false);
    expect(executorTrace.movingStartCount).toBe(1);
    expect(executorTrace.finalNodeId).toBe('n05');
    expect(executorTrace.pendingLocalRemoteActionCount).toBe(0);
    expect(coordinatorTrace.returnedOffBoardAfterStart).toBe(false);
    expect(coordinatorTrace.movingStartCount).toBeLessThanOrEqual(1);
    expect(coordinatorTrace.finalNodeId).toBe('n05');

    const finalSequences = await getRoomSequencesForQa(roomId);
    const newMoveSequences = finalSequences
      .slice(baselineSequences.length)
      .filter((sequence) => sequence.type === 'move_piece_resolved'
        && sequence.actorId === executorIdentity.ownerSeatId);
    expect(newMoveSequences).toHaveLength(1);
    expect(String(newMoveSequences[0].clientMutationId ?? '')).toMatch(new RegExp(`^move_piece:${executorIdentity.ownerSeatId}:`));
    expect(String(newMoveSequences[0].clientMutationId ?? '')).not.toContain('timeout:v1:');
    expect(Number(newMoveSequences[0].action?.payload?.clientActionStartedAt ?? 0)).toBeGreaterThan(0);
    expect(Number(newMoveSequences[0].action?.payload?.clientActionStartedAt ?? 0)).toBeLessThanOrEqual(deadlineAt);

    const finalState = await getRoomStateForQa(roomId);
    const finalPiece = finalState.pieces.find((piece) => piece?.id === executorIdentity.pieceId);
    expect(finalPiece).toMatchObject({ started: true, nodeId: 'n05' });
    expect(finalState.rollStack).toEqual([{ name: '개', steps: 2, bonus: false }]);
    expect(finalState.turnActionTimeoutCountBySeatId?.[executorIdentity.ownerSeatId] ?? 0).toBe(0);
    await expect(executorPage.getByText('시간 초과 처리 중...')).toHaveCount(0);
    expectNoBlockingConsoleErrors(hostConsoleErrors);
    expectNoBlockingConsoleErrors(guestConsoleErrors);
  });
});
