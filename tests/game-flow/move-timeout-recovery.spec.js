import { test, expect } from '@playwright/test';
import { deleteRoomForQa, getRoomSequencesForQa, getRoomStateForQa } from '../helpers/rooms.js';
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
import { seedRoomPieceAtNodeForQa } from '../helpers/room-state-fixture.js';
import {
  expectMoveTimeoutRecoveryUiProgress,
  prepareMoveTimeoutRecoveryFixture,
  waitForMoveTimeoutRecovery,
} from '../helpers/move-timeout-stateless-duplicate.js';

test.describe('일반 말 이동 제한시간 recovery', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('두 번째 연속 timeout 개 이동이 하나의 canonical action으로 완료된다', async ({ page, context }, testInfo) => {
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);

    const fixture = await prepareMoveTimeoutRecoveryFixture({ page, context, testInfo });
    roomId = fixture.roomId;
    const recovery = await waitForMoveTimeoutRecovery(fixture);

    expect(recovery.moveActionIds).toEqual([{
      sequence: expect.any(Number),
      clientMutationId: fixture.actionKey,
      actionClientId: fixture.actionKey,
    }]);
    expect(recovery.sequence.action?.payload?.rollStackIndex ?? null).toBeNull();
    expect(recovery.presentation.trace?.movingStarts).toBe(1);
    expect(recovery.presentation.trace?.benchReturns).toBe(0);
    expect(recovery.nextAiSequence?.type).toBe('roll_yut');
    expect(recovery.nextAiSequence?.actorId).not.toBe(fixture.actorId);
    await expectMoveTimeoutRecoveryUiProgress(page, {
      message: '복구 뒤 게임 화면을 유지하면서 timeout 이동을 재생하지 않고 다음 턴으로 진행해야 합니다.',
    });
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});

async function installBackDoHumanClient(context, { turnOrderResult, delayRollActionMs = 0 }) {
  await context.addInitScript(({ queuedTurnOrderResult, configuredRollDelayMs }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 50;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = configuredRollDelayMs;
    window.localStorage.setItem('yut-online:stackedRollMode', 'false');

    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (document.querySelector('.turn-order-overlay')) return;
      Math.random = () => 0.01;
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
  }, {
    queuedTurnOrderResult: turnOrderResult,
    configuredRollDelayMs: delayRollActionMs,
  });
}

async function waitForBackDoGameReady(page, { expectRollEnabled = false } = {}) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    const orderingDone = Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro;
    return orderingDone && (!expectRollEnabled || (state.rollButton.visible && !state.rollButton.disabled));
  }, {
    timeout: 50_000,
    message: '두 실제 플레이어의 순서 결정이 끝나고 대상 턴이 조작 가능해야 합니다.',
  }).toBe(true);
}

async function getLocalSeatAndPiece(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const seatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const piece = Array.isArray(debug.pieces)
      ? debug.pieces.find((candidate) => candidate?.ownerId === seatId)
      : null;
    return {
      seatId,
      pieceId: typeof piece?.id === 'string' ? piece.id : '',
      turnIndex: Number(debug.turnIndex ?? -1),
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

async function clickPerfectBackDo(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const submit = () => {
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const meter = document.querySelector('.roll-timing-live-meter');
      const positionPercent = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && !button.disabled && positionPercent >= 45 && positionPercent <= 55) {
        button.click();
        resolve(true);
        return;
      }
      if (performance.now() - startedAt > 5_000) {
        reject(new Error('Perfect 구간에서 빽도 던지기를 제출하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(submit);
    };
    requestAnimationFrame(submit);
  }));
}

function observeBackDoAutoPass(page, { initialTurnIndex, actorSeatId, collectMutationIds }) {
  return page.evaluate(({ expectedTurnIndex, expectedActorSeatId, shouldCollectMutationIds }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let moveButtonEverEnabled = false;
    let movingPieceEverActive = false;
    let captureEffectEverActive = false;
    let backDoSeen = false;
    const moveMutationIds = new Set();

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      if (moveButton instanceof HTMLButtonElement && !moveButton.disabled) moveButtonEverEnabled = true;
      if (debug.roll?.name === '빽도') backDoSeen = true;
      if (debug.movingPieceId) movingPieceEverActive = true;
      if (debug.captureEffect) captureEffectEverActive = true;
      if (shouldCollectMutationIds) {
        const mutationIds = Array.isArray(debug.actionPipeline?.localClientMutationIds)
          ? debug.actionPipeline.localClientMutationIds
          : [];
        mutationIds
          .filter((id) => typeof id === 'string' && id.startsWith(`move_piece:${expectedActorSeatId}:`))
          .forEach((id) => moveMutationIds.add(id));
      }

      const nextTurnReached = Number(debug.turnIndex ?? -1) === expectedTurnIndex + 1
        && debug.roll == null
        && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0;
      if (nextTurnReached) {
        resolve({
          turnIndex: Number(debug.turnIndex ?? -1),
          moveButtonEverEnabled,
          movingPieceEverActive,
          captureEffectEverActive,
          backDoSeen,
          moveMutationIds: [...moveMutationIds],
        });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error(`빽도 자동 패스가 다음 턴에 수렴하지 못했습니다: ${JSON.stringify({
          turnIndex: debug.turnIndex,
          roll: debug.roll,
          rollStack: debug.rollStack,
          rollStackClosed: debug.rollStackClosed,
          selectedRollStackIndex: debug.selectedRollStackIndex,
          rollAnimation: debug.rollAnimation,
          rollResultReadyAt: debug.rollResultReadyAt,
          rollResultHolding: debug.rollResultHolding,
          canSubmitTurnAction: debug.canSubmitTurnAction,
          canRequestMove: debug.canRequestMove,
          canMoveSelectedPiece: debug.canMoveSelectedPiece,
          pendingLocalRemoteActionCount: debug.pendingLocalRemoteActionCount,
          syncPipeline: debug.syncPipeline,
        })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), {
    expectedTurnIndex: initialTurnIndex,
    expectedActorSeatId: actorSeatId,
    shouldCollectMutationIds: collectMutationIds,
  });
}

function getBackDoPassSequences(sequences, actorSeatId) {
  return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
    && sequence?.actorId === actorSeatId
    && sequence?.action?.payload?.pieceId === ''
    && sequence?.payload?.skipped === true);
}

test.describe('온라인 빽도 no-movable 자동 패스', () => {
  test.setTimeout(150_000);

  let roomId;
  let guestContext;

  test.afterEach(async () => {
    await guestContext?.close().catch(() => undefined);
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    guestContext = undefined;
    roomId = undefined;
  });

  test('판 위 말이 0개인 actor의 빽도는 사용자 조작 없이 정확히 한 번 소비되어 다음 턴으로 수렴한다', async ({ browser, page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'backdo-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'backdo-guest'));
    const roomTitle = makeQaName(testInfo, 'backdo-room');
    const guestViewport = page.viewportSize() ?? { width: 1280, height: 720 };
    guestContext = await browser.newContext({ viewport: guestViewport });
    const guestPage = await guestContext.newPage();

    await primeLobbyStorage(context, {
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
    await installBackDoHumanClient(context, { turnOrderResult: '모', delayRollActionMs: 3_000 });
    await installBackDoHumanClient(guestContext, { turnOrderResult: '도' });

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await Promise.all([
      waitForBackDoGameReady(page, { expectRollEnabled: true }),
      waitForBackDoGameReady(guestPage),
    ]);

    const actor = await getLocalSeatAndPiece(page);
    const opponent = await getLocalSeatAndPiece(guestPage);
    expect(actor.seatId).not.toBe('');
    expect(actor.pieceId).not.toBe('');
    expect(opponent.seatId).not.toBe('');
    expect(opponent.pieceId).not.toBe('');
    expect(actor.turnIndex).toBe(0);

    await seedRoomPieceAtNodeForQa({
      roomId,
      authPage: page,
      ownerSeatId: opponent.seatId,
      pieceId: opponent.pieceId,
      nodeId: 'n06',
      previousNodeId: 'n05',
      turnDeadlineAt: Date.now() + 60_000,
    });
    await Promise.all([page.reload(), guestPage.reload()]);
    await Promise.all([
      waitForBackDoGameReady(page, { expectRollEnabled: true }),
      waitForBackDoGameReady(guestPage),
      waitForPieceNode(page, opponent.pieceId, 'n06'),
      waitForPieceNode(guestPage, opponent.pieceId, 'n06'),
    ]);

    const actorStateBefore = await page.evaluate(({ actorSeatId }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const actorPieces = Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === actorSeatId)
        : [];
      return {
        turnIndex: Number(debug.turnIndex ?? -1),
        stackedRollMode: Boolean(debug.stackedRollMode),
        actorBoardPieceCount: actorPieces.filter((piece) => piece?.started && !piece?.finished).length,
      };
    }, { actorSeatId: actor.seatId });
    expect(actorStateBefore).toEqual({ turnIndex: 0, stackedRollMode: false, actorBoardPieceCount: 0 });

    const actorTracePromise = observeBackDoAutoPass(page, {
      initialTurnIndex: actorStateBefore.turnIndex,
      actorSeatId: actor.seatId,
      collectMutationIds: true,
    });
    const observerTracePromise = observeBackDoAutoPass(guestPage, {
      initialTurnIndex: actorStateBefore.turnIndex,
      actorSeatId: actor.seatId,
      collectMutationIds: false,
    });

    await clickPerfectBackDo(page);
    const [actorTrace, observerTrace] = await Promise.all([actorTracePromise, observerTracePromise]);

    expect(actorTrace.backDoSeen).toBe(true);
    expect(observerTrace.backDoSeen).toBe(true);
    expect(actorTrace.moveButtonEverEnabled).toBe(false);
    expect(observerTrace.moveButtonEverEnabled).toBe(false);
    expect(actorTrace.movingPieceEverActive).toBe(false);
    expect(observerTrace.movingPieceEverActive).toBe(false);
    expect(actorTrace.captureEffectEverActive).toBe(false);
    expect(observerTrace.captureEffectEverActive).toBe(false);
    expect(actorTrace.moveMutationIds).toHaveLength(1);
    expect(actorTrace.turnIndex).toBe(actorStateBefore.turnIndex + 1);
    expect(observerTrace.turnIndex).toBe(actorStateBefore.turnIndex + 1);

    await expect.poll(async () => {
      const state = await collectScreenState(guestPage);
      return state.rollButton.visible && !state.rollButton.disabled;
    }, { timeout: 15_000, message: '자동 패스 뒤 다음 플레이어가 정상적으로 던질 수 있어야 합니다.' }).toBe(true);

    const [authoritativeState, sequences] = await Promise.all([
      getRoomStateForQa(roomId),
      getRoomSequencesForQa(roomId),
    ]);
    const passSequences = getBackDoPassSequences(sequences, actor.seatId);
    expect(passSequences).toHaveLength(1);
    expect(passSequences[0]?.action?.payload?.clientActionStartedAt ?? 0).toBe(0);
    expect(Number(authoritativeState?.turnIndex ?? -1)).toBe(actorStateBefore.turnIndex + 1);
    expect(authoritativeState?.roll ?? null).toBeNull();
    expect(authoritativeState?.lastMovedPieceIds ?? []).toEqual([]);
    expect(authoritativeState?.captureEffect ?? null).toBeNull();
    const authoritativeOpponentPiece = Array.isArray(authoritativeState?.pieces)
      ? authoritativeState.pieces.find((piece) => piece?.id === opponent.pieceId)
      : null;
    expect(authoritativeOpponentPiece?.nodeId).toBe('n06');

    await Promise.all([page.reload(), guestPage.reload()]);
    await Promise.all([
      waitForBackDoGameReady(page),
      waitForBackDoGameReady(guestPage, { expectRollEnabled: true }),
    ]);
    const sequencesAfterRemount = await getRoomSequencesForQa(roomId);
    expect(getBackDoPassSequences(sequencesAfterRemount, actor.seatId)).toHaveLength(1);
  });
});
