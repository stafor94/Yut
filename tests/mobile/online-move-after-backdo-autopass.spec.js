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
      queueMicrotask(() => { Math.random = nativeRandom; });
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
    const seatId = String(debug.localSeatId ?? '');
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

async function expectNoPieceBackDoWaitsForPresentation({ actorPage, nextPage, roomId, actorSeatId }) {
  await submitPerfectRoll(actorPage);
  await expect(actorPage.getByTestId('roll-result-card')).toBeVisible({ timeout: 10_000 });
  await expect(actorPage.getByTestId('roll-result-card')).toContainText('빽도');

  const sequencesWhileVisible = await getRoomSequencesForQa(roomId);
  expect(sequencesWhileVisible.filter((sequence) => sequence?.type === 'move_piece_resolved'
    && sequence?.actorId === actorSeatId
    && sequence?.action?.payload?.pieceId === '')).toHaveLength(0);
  const moveButton = actorPage.getByTestId('move-piece-button');
  if (await moveButton.count()) await expect(moveButton).toBeDisabled();

  await expect(actorPage.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === actorSeatId
      && sequence?.action?.payload?.pieceId === '').length;
  }, { timeout: 15_000, intervals: [50, 100, 200, 400], message: 'presentation 완료 뒤 말 없는 빽도 자동 패스가 정확히 한 번 제출되어야 합니다.' }).toBe(1);

  await expect.poll(async () => {
    const state = await collectScreenState(nextPage);
    return state.rollButton.visible && !state.rollButton.disabled;
  }, { timeout: 15_000, intervals: [50, 100, 200, 400], message: '빽도 자동 패스 뒤 다음 실제 플레이어의 roll action이 열려야 합니다.' }).toBe(true);
}

function observeGaeAutoMove(page, identity) {
  return page.evaluate((target) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let buttonEnabledSeen = false;
    let movedBeforeEnabled = false;
    let movingActive = false;
    let movingStarts = 0;
    let lastNodeId = 'n01';
    const nodeTransitions = [];
    const moveActionIds = new Set();

    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const pieces = Array.isArray(debug.pieces) ? debug.pieces : [];
      const firstPiece = pieces.find((piece) => piece?.id === target.firstPieceId);
      const secondPiece = pieces.find((piece) => piece?.id === target.secondPieceId);
      const button = document.querySelector('[data-testid="move-piece-button"]');
      const moveEnabled = button instanceof HTMLButtonElement && !button.disabled;
      if (moveEnabled) buttonEnabledSeen = true;
      if (!buttonEnabledSeen && firstPiece && (firstPiece.nodeId !== 'n01' || debug.movingPieceId === target.firstPieceId)) movedBeforeEnabled = true;
      if (firstPiece?.nodeId && firstPiece.nodeId !== lastNodeId) {
        lastNodeId = firstPiece.nodeId;
        nodeTransitions.push(firstPiece.nodeId);
      }
      const movingNow = debug.movingPieceId === target.firstPieceId;
      if (movingNow && !movingActive) movingStarts += 1;
      movingActive = movingNow;
      const ids = Array.isArray(debug.actionPipeline?.localClientMutationIds) ? debug.actionPipeline.localClientMutationIds : [];
      ids.filter((id) => typeof id === 'string' && id.startsWith(`move_piece:${target.seatId}:`)).forEach((id) => moveActionIds.add(id));

      const settled = firstPiece?.nodeId === 'n03'
        && secondPiece?.nodeId === 'n01'
        && secondPiece?.started === false
        && secondPiece?.finished === false
        && !movingNow
        && debug.roll == null
        && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0;
      if (settled) {
        resolve({ buttonEnabledSeen, movedBeforeEnabled, movingStarts, nodeTransitions, moveActionIds: [...moveActionIds] });
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error(`빽도 이력 뒤 말 2개+개 이동이 완료되지 않았습니다: ${JSON.stringify({
          activeSeat: debug.activeSeat,
          localSeatId: debug.localSeatId,
          isMyTurn: debug.isMyTurn,
          pieces: debug.pieces,
          canMoveSelectedPiece: debug.canMoveSelectedPiece,
          canSubmitTurnAction: debug.canSubmitTurnAction,
          canRequestMove: debug.canRequestMove,
          pendingLocalRemoteActionCount: debug.pendingLocalRemoteActionCount,
          roll: debug.roll,
          rollResultHolding: debug.rollResultHolding,
          movingPieceId: debug.movingPieceId,
          turnDeadlineKind: debug.turnDeadlineKind,
          turnDeadlineAt: debug.turnDeadlineAt,
        })}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), identity);
}

function observeRemoteMove(page, pieceId) {
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
        resolve(movingStarts);
        return;
      }
      if (performance.now() - startedAt > 35_000) {
        reject(new Error('상대 클라이언트의 개 이동 presentation이 완료되지 않았습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), pieceId);
}

test('출발점 말 2개는 말 없는 빽도 presentation 완료 뒤 자동 패스한 후 개를 정상 자동 이동한다', async ({ browser, page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
  testInfo.setTimeout(180_000);
  await page.setViewportSize({ width: 412, height: 915 });
  const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestPage = await guestContext.newPage();
  let roomId = '';

  try {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'backdo-gate-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'backdo-gate-guest'));
    const roomTitle = makeQaName(testInfo, 'backdo-gate-room');
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

    await expectNoPieceBackDoWaitsForPresentation({ actorPage: page, nextPage: guestPage, roomId, actorSeatId: hostIdentity.seatId });
    await expectNoPieceBackDoWaitsForPresentation({ actorPage: guestPage, nextPage: page, roomId, actorSeatId: guestIdentity.seatId });

    const beforeGae = await page.evaluate((seatId) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      return (Array.isArray(debug.pieces) ? debug.pieces : []).filter((piece) => piece?.ownerId === seatId);
    }, hostIdentity.seatId);
    expect(beforeGae).toHaveLength(2);
    expect(beforeGae.every((piece) => piece.nodeId === 'n01' && piece.started === false && piece.finished === false)).toBe(true);

    const localMovePromise = observeGaeAutoMove(page, hostIdentity);
    const remoteMovePromise = observeRemoteMove(guestPage, hostIdentity.firstPieceId);
    await submitPerfectRoll(page);
    const [localMove, remoteMovingStarts] = await Promise.all([localMovePromise, remoteMovePromise]);

    expect(localMove.buttonEnabledSeen).toBe(true);
    expect(localMove.movedBeforeEnabled).toBe(false);
    expect(localMove.nodeTransitions).toEqual(['n02', 'n03']);
    expect(localMove.movingStarts).toBe(1);
    expect(remoteMovingStarts).toBe(1);

    const sequences = await getRoomSequencesForQa(roomId);
    const hostRolls = sequences.filter((sequence) => sequence?.type === 'roll_yut' && sequence?.actorId === hostIdentity.seatId);
    expect(hostRolls.some((sequence) => String(sequence?.payload?.rollName ?? sequence?.patch?.roll?.name ?? '') === '개'
      && Number(sequence?.payload?.rollSteps ?? sequence?.patch?.roll?.steps ?? NaN) === 2)).toBe(true);
    const hostConcreteMoves = sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === hostIdentity.seatId
      && sequence?.action?.payload?.pieceId === hostIdentity.firstPieceId);
    expect(hostConcreteMoves).toHaveLength(1);
  } finally {
    await guestContext.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
  }
});
