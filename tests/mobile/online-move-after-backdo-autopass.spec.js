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

async function installQueuedRollClient(context, { turnOrderResult, rollRandoms }) {
  await context.addInitScript(({ queuedTurnOrderResult, queuedRollRandoms }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.localStorage.setItem('yut-online:stackedRollMode', 'false');
    let rollIndex = 0;
    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (document.querySelector('.turn-order-overlay')) return;
      const configuredRandom = queuedRollRandoms[Math.min(rollIndex, queuedRollRandoms.length - 1)];
      rollIndex += 1;
      Math.random = () => configuredRandom;
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
  }, { queuedTurnOrderResult: turnOrderResult, queuedRollRandoms: rollRandoms });
}

async function waitForGameReady(page, { rollEnabled = false } = {}) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    const orderingDone = Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro;
    return orderingDone && (!rollEnabled || (state.rollButton.visible && !state.rollButton.disabled));
  }, { timeout: 50_000, message: '두 실제 플레이어의 순서 결정이 끝나야 합니다.' }).toBe(true);
}

async function getLocalIdentity(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const seatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const pieces = Array.isArray(debug.pieces)
      ? debug.pieces
        .filter((piece) => piece?.ownerId === seatId)
        .sort((left, right) => String(left?.label ?? '').localeCompare(String(right?.label ?? ''), undefined, { numeric: true }))
      : [];
    return {
      seatId,
      firstPieceId: String(pieces[0]?.id ?? ''),
      secondPieceId: String(pieces[1]?.id ?? ''),
    };
  });
}

async function submitPerfectRoll(page) {
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
        reject(new Error('Perfect 구간에서 roll action을 제출하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(submit);
    };
    requestAnimationFrame(submit);
  }));
}

async function runNoMovableBackDoTurn(actorPage, nextPage) {
  const before = await actorPage.evaluate(() => ({
    turnIndex: Number(window.__YUT_DEBUG_STATE__?.turnIndex ?? -1),
    localSeatId: String(window.__YUT_DEBUG_STATE__?.localSeatId ?? ''),
  }));
  const tracePromise = actorPage.evaluate(({ expectedTurnIndex, actorSeatId }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let backDoSeen = false;
    let moveButtonEnabled = false;
    let movingPieceSeen = false;
    const moveActionIds = new Set();
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      if (moveButton instanceof HTMLButtonElement && !moveButton.disabled) moveButtonEnabled = true;
      if (debug.roll?.name === '빽도') backDoSeen = true;
      if (debug.movingPieceId) movingPieceSeen = true;
      const ids = Array.isArray(debug.actionPipeline?.localClientMutationIds) ? debug.actionPipeline.localClientMutationIds : [];
      ids.filter((id) => typeof id === 'string' && id.startsWith(`move_piece:${actorSeatId}:`)).forEach((id) => moveActionIds.add(id));
      if (Number(debug.turnIndex ?? -1) === expectedTurnIndex + 1
        && debug.roll == null
        && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0) {
        resolve({
          backDoSeen,
          moveButtonEnabled,
          movingPieceSeen,
          moveActionIds: [...moveActionIds],
          pendingGateAfterPass: window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null,
        });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error(`말 없는 빽도 자동 패스가 완료되지 않았습니다: ${JSON.stringify({
          turnIndex: debug.turnIndex,
          roll: debug.roll,
          canSubmitTurnAction: debug.canSubmitTurnAction,
          canRequestMove: debug.canRequestMove,
          pendingLocalRemoteActionCount: debug.pendingLocalRemoteActionCount,
          pendingGate: window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null,
        })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { expectedTurnIndex: before.turnIndex, actorSeatId: before.localSeatId });

  await submitPerfectRoll(actorPage);
  const trace = await tracePromise;
  expect(trace.backDoSeen).toBe(true);
  expect(trace.moveButtonEnabled).toBe(false);
  expect(trace.movingPieceSeen).toBe(false);
  expect(trace.moveActionIds).toHaveLength(1);
  await expect.poll(async () => {
    const state = await collectScreenState(nextPage);
    return state.rollButton.visible && !state.rollButton.disabled;
  }, { timeout: 15_000, intervals: [50, 100, 200, 400], message: '빽도 자동 패스 뒤 다음 플레이어의 roll action이 열려야 합니다.' }).toBe(true);
  return trace;
}

function observeGaeAfterBackDoHistory(page, identity) {
  return page.evaluate((input) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let actionReadyAt = 0;
    let moveButtonEnabledSeen = false;
    let movedBeforeEnabled = false;
    let movingActive = false;
    let movingStarts = 0;
    let lastNodeId = 'n01';
    const nodeTransitions = [];
    const moveActionIds = new Set();

    const snapshot = (debug) => ({
      activeSeat: debug.activeSeat,
      localSeatId: debug.localSeatId,
      isMyTurn: debug.isMyTurn,
      pieces: debug.pieces,
      selectedPieceId: debug.selectedPieceId,
      activeMovablePiece: debug.activeMovablePiece,
      canMoveSelectedPiece: debug.canMoveSelectedPiece,
      canSubmitTurnAction: debug.canSubmitTurnAction,
      canRequestMove: debug.canRequestMove,
      turnActionBlockReasons: debug.turnActionBlockReasons,
      moveActionBlockReasons: debug.moveActionBlockReasons,
      hasPendingGameStateSave: debug.hasPendingGameStateSave,
      coordinatorStateSaveKey: debug.coordinatorStateSaveKey,
      pendingLocalRemoteActionCount: debug.pendingLocalRemoteActionCount,
      pendingLocalRemoteActions: debug.pendingLocalRemoteActions,
      actionPipelinePending: debug.actionPipeline?.pendingLocalRemoteActions,
      pendingRemoteActionGate: window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null,
      roll: debug.roll,
      rollResultHolding: debug.rollResultHolding,
      rollInProgress: debug.rollInProgress,
      movingPieceId: debug.movingPieceId,
      turnDeadlineKind: debug.turnDeadlineKind,
      turnDeadlineAt: debug.turnDeadlineAt,
      rollResultReadyAt: debug.rollResultReadyAt,
      effectiveRollResultReadyAt: debug.effectiveRollResultReadyAt,
      stalledTurn: debug.stalledTurn,
    });

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const pieces = Array.isArray(debug.pieces) ? debug.pieces : [];
      const firstPiece = pieces.find((piece) => piece?.id === input.firstPieceId);
      const secondPiece = pieces.find((piece) => piece?.id === input.secondPieceId);
      const button = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = button instanceof HTMLButtonElement && !button.disabled;
      if (moveEnabled) moveButtonEnabledSeen = true;
      if (!moveEnabled && firstPiece && (firstPiece.nodeId !== 'n01' || debug.movingPieceId === input.firstPieceId)) movedBeforeEnabled = true;
      if (firstPiece?.nodeId && firstPiece.nodeId !== lastNodeId) {
        lastNodeId = firstPiece.nodeId;
        nodeTransitions.push(firstPiece.nodeId);
      }
      const movingNow = debug.movingPieceId === input.firstPieceId;
      if (movingNow && !movingActive) movingStarts += 1;
      movingActive = movingNow;
      const ids = Array.isArray(debug.actionPipeline?.localClientMutationIds) ? debug.actionPipeline.localClientMutationIds : [];
      ids.filter((id) => typeof id === 'string' && id.startsWith(`move_piece:${input.seatId}:`)).forEach((id) => moveActionIds.add(id));

      const effectiveReadyAt = Number(debug.effectiveRollResultReadyAt ?? debug.rollResultReadyAt ?? 0);
      if (!actionReadyAt && debug.roll?.name === '개' && debug.turnDeadlineKind === 'move' && !debug.rollResultHolding && effectiveReadyAt > 0 && Date.now() >= effectiveReadyAt) {
        actionReadyAt = Date.now();
      }
      if (actionReadyAt && !moveEnabled && debug.canRequestMove === false && Date.now() - actionReadyAt >= 500) {
        reject(new Error(`빽도 이력 뒤 말 2개+개 고착 프레임: ${JSON.stringify(snapshot(debug))}`));
        return;
      }

      const settled = firstPiece?.nodeId === 'n03'
        && secondPiece?.nodeId === 'n01'
        && secondPiece?.started === false
        && secondPiece?.finished === false
        && debug.roll == null
        && !movingNow
        && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0;
      if (settled) {
        resolve({ moveButtonEnabledSeen, movedBeforeEnabled, movingStarts, nodeTransitions, moveActionIds: [...moveActionIds] });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error(`빽도 이력 뒤 개 이동이 완료되지 않았습니다: ${JSON.stringify(snapshot(debug))}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), identity);
}

test('출발점 말 2개가 남은 플레이어가 이전 말 없는 빽도 자동 패스 뒤 개를 던져도 자동 이동한다', async ({ browser, page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
  testInfo.setTimeout(180_000);
  await page.setViewportSize({ width: 412, height: 915 });
  const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestPage = await guestContext.newPage();
  let roomId = '';

  try {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'backdo-history-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'backdo-history-guest'));
    const roomTitle = makeQaName(testInfo, 'backdo-history-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '2' });
    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '2' });
    await installQueuedRollClient(context, { turnOrderResult: '모', rollRandoms: [0.01, 0.4] });
    await installQueuedRollClient(guestContext, { turnOrderResult: '도', rollRandoms: [0.01] });

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await Promise.all([waitForGameReady(page, { rollEnabled: true }), waitForGameReady(guestPage)]);

    const [hostIdentity, guestIdentity] = await Promise.all([getLocalIdentity(page), getLocalIdentity(guestPage)]);
    expect(hostIdentity.firstPieceId).not.toBe('');
    expect(hostIdentity.secondPieceId).not.toBe('');
    expect(guestIdentity.firstPieceId).not.toBe('');
    expect(guestIdentity.secondPieceId).not.toBe('');

    const hostBackDo = await runNoMovableBackDoTurn(page, guestPage);
    const guestBackDo = await runNoMovableBackDoTurn(guestPage, page);

    const boardBeforeGae = await page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return {
        pieces: debug.pieces,
        pendingGate: window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null,
      };
    });
    expect(boardBeforeGae.pieces).toHaveLength(4);
    expect(boardBeforeGae.pieces.every((piece) => piece.nodeId === 'n01' && piece.started === false && piece.finished === false)).toBe(true);

    const moveTracePromise = observeGaeAfterBackDoHistory(page, hostIdentity);
    await submitPerfectRoll(page);
    const moveTrace = await moveTracePromise;

    expect(moveTrace.moveButtonEnabledSeen).toBe(true);
    expect(moveTrace.movedBeforeEnabled).toBe(false);
    expect(moveTrace.nodeTransitions).toEqual(['n02', 'n03']);
    expect(moveTrace.movingStarts).toBe(1);
    expect(moveTrace.moveActionIds.filter((id) => !hostBackDo.moveActionIds.includes(id))).toHaveLength(1);

    const sequences = await getRoomSequencesForQa(roomId);
    const hostBackDoPasses = sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === hostIdentity.seatId
      && sequence?.action?.payload?.pieceId === ''
      && sequence?.payload?.skipped === true);
    const guestBackDoPasses = sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === guestIdentity.seatId
      && sequence?.action?.payload?.pieceId === ''
      && sequence?.payload?.skipped === true);
    const hostConcreteMoves = sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === hostIdentity.seatId
      && sequence?.action?.payload?.pieceId === hostIdentity.firstPieceId);
    expect(hostBackDoPasses).toHaveLength(1);
    expect(guestBackDoPasses).toHaveLength(1);
    expect(hostConcreteMoves).toHaveLength(1);
    expect(guestBackDo.pendingGateAfterPass?.entries ?? []).toEqual([]);
  } finally {
    await guestContext.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
  }
});
