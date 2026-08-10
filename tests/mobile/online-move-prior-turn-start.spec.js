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

async function installTwoPieceGaeClient(context, turnOrderResult) {
  await context.addInitScript((queuedTurnOrderResult) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;
    window.localStorage.setItem('yut-online:stackedRollMode', 'false');

    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (document.querySelector('.turn-order-overlay')) return;
      Math.random = () => 0.4;
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
  }, turnOrderResult);
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

async function getLocalPieceIdentity(page) {
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
      pieceId: String(pieces[0]?.id ?? ''),
      otherPieceId: String(pieces[1]?.id ?? ''),
    };
  });
}

async function submitPerfectGae(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const submit = () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const positionPercent = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && !button.disabled && positionPercent >= 45 && positionPercent <= 55) {
        button.click();
        resolve(true);
        return;
      }
      if (performance.now() - startedAt > 3_000) {
        reject(new Error('Perfect 구간에서 개 roll action을 제출하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(submit);
    };
    requestAnimationFrame(submit);
  }));
}

async function waitForAutoMoveTurnCompletion(page, pieceId, nextTurnPage) {
  await expect.poll(async () => page.evaluate((trackedPieceId) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const piece = Array.isArray(debug.pieces) ? debug.pieces.find((candidate) => candidate?.id === trackedPieceId) : null;
    return piece?.nodeId === 'n03'
      && debug.roll == null
      && !debug.movingPieceId
      && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0;
  }, pieceId), { timeout: 45_000, intervals: [100, 250, 500], message: '선행 actor의 개 자동 이동이 완료되어야 합니다.' }).toBe(true);
  await expect.poll(async () => {
    const state = await collectScreenState(nextTurnPage);
    return state.rollButton.visible && !state.rollButton.disabled;
  }, { timeout: 15_000, intervals: [100, 250, 500], message: '선행 actor 이동 뒤 다음 실제 플레이어의 roll action이 열려야 합니다.' }).toBe(true);
}

function observeTwoPieceGaeAutoMove(page, { pieceId, otherPieceId, seatId }) {
  return page.evaluate((input) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let moveButtonEnabledSeen = false;
    let movedBeforeEnabled = false;
    let lastNodeId = 'n01';
    let movingActive = false;
    let movingStarts = 0;
    const nodeTransitions = [];
    const moveActionIds = new Set();
    let pendingAtReady = null;

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = moveButton instanceof HTMLButtonElement && !moveButton.disabled;
      const pieces = Array.isArray(debug.pieces) ? debug.pieces : [];
      const piece = pieces.find((candidate) => candidate?.id === input.pieceId);
      const otherPiece = pieces.find((candidate) => candidate?.id === input.otherPieceId);
      if (moveEnabled && !moveButtonEnabledSeen) {
        moveButtonEnabledSeen = true;
        pendingAtReady = window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null;
      }
      if (!moveButtonEnabledSeen && piece && (piece.nodeId !== 'n01' || debug.movingPieceId === input.pieceId)) movedBeforeEnabled = true;
      if (piece?.nodeId && piece.nodeId !== lastNodeId) {
        lastNodeId = piece.nodeId;
        nodeTransitions.push(piece.nodeId);
      }
      const movingNow = debug.movingPieceId === input.pieceId;
      if (movingNow && !movingActive) movingStarts += 1;
      movingActive = movingNow;
      const ids = Array.isArray(debug.actionPipeline?.localClientMutationIds) ? debug.actionPipeline.localClientMutationIds : [];
      ids.filter((id) => typeof id === 'string' && id.startsWith(`move_piece:${input.seatId}:`)).forEach((id) => moveActionIds.add(id));

      const settled = piece?.nodeId === 'n03'
        && otherPiece?.nodeId === 'n01'
        && otherPiece?.started === false
        && otherPiece?.finished === false
        && !movingNow
        && debug.roll == null
        && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0;
      if (settled) {
        resolve({ moveButtonEnabledSeen, movedBeforeEnabled, nodeTransitions, movingStarts, moveActionIds: [...moveActionIds], pendingAtReady });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error(`이전 상대 턴 뒤 말 2개+개 action-ready가 고착됐습니다: ${JSON.stringify({
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
          pendingLocalRemoteActionCount: debug.pendingLocalRemoteActionCount,
          pendingLocalRemoteActions: debug.actionPipeline?.pendingLocalRemoteActions,
          pendingRemoteActionGate: window.__YUT_PENDING_REMOTE_ACTION_DEBUG__ ?? null,
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
  }), { pieceId, otherPieceId, seatId });
}

function observeRemotePieceMove(page, pieceId) {
  return page.evaluate((trackedPieceId) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let movingActive = false;
    let movingStarts = 0;
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const piece = Array.isArray(debug.pieces) ? debug.pieces.find((candidate) => candidate?.id === trackedPieceId) : null;
      const movingNow = debug.movingPieceId === trackedPieceId;
      if (movingNow && !movingActive) movingStarts += 1;
      movingActive = movingNow;
      if (piece?.nodeId === 'n03' && !movingNow && debug.roll == null) {
        resolve({ movingStarts });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error('상대 클라이언트가 개 이동 presentation을 완료하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), pieceId);
}

test('출발점 상대 턴 lifecycle 뒤 말 2개가 대기 중인 actor의 개는 lowest-label 말을 자동 이동한다', async ({ browser, page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
  testInfo.setTimeout(180_000);
  await page.setViewportSize({ width: 412, height: 915 });
  const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestPage = await guestContext.newPage();
  let roomId = '';

  try {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'prior-turn-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'prior-turn-guest'));
    const roomTitle = makeQaName(testInfo, 'prior-turn-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '2' });
    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '2' });
    await installTwoPieceGaeClient(context, '모');
    await installTwoPieceGaeClient(guestContext, '도');

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await Promise.all([waitForGameReady(page, { rollEnabled: true }), waitForGameReady(guestPage)]);

    const [hostIdentity, guestIdentity] = await Promise.all([getLocalPieceIdentity(page), getLocalPieceIdentity(guestPage)]);
    expect(hostIdentity.pieceId).not.toBe('');
    expect(guestIdentity.pieceId).not.toBe('');
    expect(guestIdentity.otherPieceId).not.toBe('');

    await submitPerfectGae(page);
    await waitForAutoMoveTurnCompletion(page, hostIdentity.pieceId, guestPage);

    const guestBefore = await guestPage.evaluate((seatId) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === seatId).map((piece) => ({ id: piece.id, nodeId: piece.nodeId, started: piece.started, finished: piece.finished }))
        : [];
    }, guestIdentity.seatId);
    expect(guestBefore).toHaveLength(2);
    expect(guestBefore.every((piece) => piece.nodeId === 'n01' && piece.started === false && piece.finished === false)).toBe(true);

    const localTracePromise = observeTwoPieceGaeAutoMove(guestPage, guestIdentity);
    const remoteTracePromise = observeRemotePieceMove(page, guestIdentity.pieceId);
    await submitPerfectGae(guestPage);
    const [localTrace, remoteTrace] = await Promise.all([localTracePromise, remoteTracePromise]);

    expect(localTrace.moveButtonEnabledSeen).toBe(true);
    expect(localTrace.movedBeforeEnabled).toBe(false);
    expect(localTrace.nodeTransitions).toEqual(['n02', 'n03']);
    expect(localTrace.movingStarts).toBe(1);
    expect(localTrace.moveActionIds).toHaveLength(1);
    expect(localTrace.pendingAtReady?.entries ?? []).toEqual([]);
    expect(remoteTrace.movingStarts).toBe(1);

    const sequences = await getRoomSequencesForQa(roomId);
    const guestRolls = sequences.filter((sequence) => sequence?.type === 'roll_yut' && sequence?.actorId === guestIdentity.seatId);
    expect(guestRolls.some((sequence) => String(sequence?.payload?.rollName ?? sequence?.patch?.roll?.name ?? '') === '개'
      && Number(sequence?.payload?.rollSteps ?? sequence?.patch?.roll?.steps ?? NaN) === 2)).toBe(true);
    const guestMoves = sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === guestIdentity.seatId
      && String(sequence?.clientMutationId ?? '').startsWith(`move_piece:${guestIdentity.seatId}:`));
    expect(guestMoves).toHaveLength(1);

    await expect.poll(async () => {
      const state = await collectScreenState(page);
      return state.rollButton.visible && !state.rollButton.disabled;
    }, { timeout: 15_000, intervals: [100, 250, 500], message: '두 번째 개 이동 뒤 다음 실제 플레이어 턴으로 전환되어야 합니다.' }).toBe(true);
  } finally {
    await guestContext.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
  }
});
