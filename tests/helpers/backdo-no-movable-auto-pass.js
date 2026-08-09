import { expect } from '@playwright/test';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import { makeQaName, normalizeQaNickname } from './env.js';
import { waitForRoomQaAccess } from './room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa, getRoomStateForQa } from './rooms.js';
import {
  collectScreenState,
  createRoomFromLobby,
  joinRoomFromLobby,
  markGuestReady,
  primeLobbyStorage,
} from './ui.js';

async function installBackDoHumanClient(context, { delayRollActionMs = 0 } = {}) {
  await context.addInitScript((configuredRollDelayMs) => {
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
  }, delayRollActionMs);
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
    timeout: 20_000,
    intervals: [50, 100, 200, 400],
    message: 'authoritative 빽도 fixture가 두 클라이언트의 조작 가능 상태로 수렴해야 합니다.',
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

async function waitForLocalSeatAndPiece(page, label) {
  let snapshot = null;
  await expect.poll(async () => {
    snapshot = await getLocalSeatAndPiece(page);
    return Boolean(snapshot.seatId && snapshot.pieceId);
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: `${label}의 authoritative seat와 piece가 준비되어야 합니다.`,
  }).toBe(true);
  return snapshot;
}

async function waitForPieceNode(page, pieceId, nodeId) {
  await expect.poll(() => page.evaluate(({ trackedPieceId, expectedNodeId }) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    return Array.isArray(debug.pieces)
      ? debug.pieces.find((piece) => piece?.id === trackedPieceId)?.nodeId === expectedNodeId
      : false;
  }, { trackedPieceId: pieceId, expectedNodeId: nodeId }), {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
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

async function prepareAuthoritativeBackDoState({ roomId, page, guestPage, actor, opponent }) {
  const state = await getRoomStateForQa(roomId);
  if (!state || !Array.isArray(state.pieces)) throw new Error('빽도 fixture를 준비할 authoritative state가 없습니다.');

  const fixturePieces = state.pieces.map((piece) => {
    if (piece?.id === actor.pieceId && piece?.ownerId === actor.seatId) {
      return {
        ...piece,
        nodeId: 'n01',
        nodeIndex: 0,
        previousNodeId: '',
        started: false,
        finished: false,
      };
    }
    if (piece?.id === opponent.pieceId && piece?.ownerId === opponent.seatId) {
      return {
        ...piece,
        nodeId: 'n06',
        nodeIndex: 5,
        previousNodeId: 'n05',
        started: true,
        finished: false,
      };
    }
    return piece;
  });
  const readyAt = Date.now();
  await commitAuthoritativeStatePatchForQa(page, roomId, {
    turnIndex: 0,
    turnOrderIds: [actor.seatId, opponent.seatId],
    initialTurnOrderIds: [actor.seatId, opponent.seatId],
    turnOrderIntro: null,
    turnOrderPhase: { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 },
    waitingForPlayersReady: false,
    gameStartedAt: readyAt,
    pieces: fixturePieces,
    roll: null,
    rollStack: [],
    selectedRollStackIndex: null,
    rollStackClosed: false,
    rollAnimation: null,
    rollResultReadyAt: 0,
    pendingGoldenYutSelection: null,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: null,
    branchChoice: 'outer',
    lastMovedPieceIds: [],
    lastMovedSeatId: '',
    captureEffect: null,
    trapEffect: null,
    fallEffect: null,
    turnDeadlineKind: 'roll',
    turnDeadlineAt: readyAt + 60_000,
  }, actor.seatId, {
    fixtureName: 'backdo-no-movable-ready',
    errorLabel: 'BackDo no-movable ready fixture',
  });

  await Promise.all([
    waitForBackDoGameReady(page, { expectRollEnabled: true }),
    waitForBackDoGameReady(guestPage),
    waitForPieceNode(page, opponent.pieceId, 'n06'),
    waitForPieceNode(guestPage, opponent.pieceId, 'n06'),
  ]);
}

export async function runBackDoNoMovableAutoPassQa({ browser, page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'backdo-host'));
  const guestName = normalizeQaNickname(makeQaName(testInfo, 'backdo-guest'));
  const roomTitle = makeQaName(testInfo, 'backdo-room');
  const guestViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const guestContext = await browser.newContext({ viewport: guestViewport });
  const guestPage = await guestContext.newPage();
  let roomId;

  try {
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
    await installBackDoHumanClient(context, { delayRollActionMs: 3_000 });
    await installBackDoHumanClient(guestContext);

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();

    await expect.poll(async () => {
      const state = await getRoomStateForQa(roomId);
      return Boolean(
        state
        && Array.isArray(state.pieces)
        && state.pieces.length === 2
        && Array.isArray(state.gameSeats)
        && state.gameSeats.length === 2,
      );
    }, {
      timeout: 35_000,
      intervals: [100, 200, 400, 800],
      message: '초기 authoritative game state가 생성되어야 합니다.',
    }).toBe(true);
    await Promise.all([
      expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 }),
      expect(guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 }),
    ]);

    const [actor, opponent] = await Promise.all([
      waitForLocalSeatAndPiece(page, 'actor'),
      waitForLocalSeatAndPiece(guestPage, 'observer'),
    ]);
    expect(actor.seatId).not.toBe('');
    expect(actor.pieceId).not.toBe('');
    expect(opponent.seatId).not.toBe('');
    expect(opponent.pieceId).not.toBe('');

    await prepareAuthoritativeBackDoState({ roomId, page, guestPage, actor, opponent });

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
    }, {
      timeout: 15_000,
      intervals: [50, 100, 200, 400],
      message: '자동 패스 뒤 다음 플레이어가 정상적으로 던질 수 있어야 합니다.',
    }).toBe(true);

    const [authoritativeState, sequences] = await Promise.all([
      getRoomStateForQa(roomId),
      getRoomSequencesForQa(roomId),
    ]);
    const passSequences = getBackDoPassSequences(sequences, actor.seatId);
    expect(passSequences).toHaveLength(1);
    expect(passSequences[0]?.clientMutationId).toBe(actorTrace.moveMutationIds[0]);
    const backDoRollSequence = sequences.find((sequence) => sequence?.type === 'roll_yut'
      && sequence?.actorId === actor.seatId
      && sequence?.payload?.rollName === '빽도');
    const rollReadyAt = Number(backDoRollSequence?.payload?.rollPresentationReadyAt
      ?? backDoRollSequence?.patch?.rollResultReadyAt
      ?? 0);
    const passStartedAt = Number(passSequences[0]?.action?.payload?.clientActionStartedAt ?? 0);
    expect(rollReadyAt).toBeGreaterThan(0);
    expect(passStartedAt).toBeGreaterThanOrEqual(rollReadyAt);
    expect(Number(authoritativeState?.turnIndex ?? -1)).toBe(actorStateBefore.turnIndex + 1);
    expect(authoritativeState?.roll ?? null).toBeNull();
    expect(authoritativeState?.lastMovedPieceIds ?? []).toEqual([]);
    expect(authoritativeState?.captureEffect ?? null).toBeNull();
    const authoritativeOpponentPiece = Array.isArray(authoritativeState?.pieces)
      ? authoritativeState.pieces.find((piece) => piece?.id === opponent.pieceId)
      : null;
    expect(authoritativeOpponentPiece?.nodeId).toBe('n06');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBackDoGameReady(page);
    const sequencesAfterRemount = await getRoomSequencesForQa(roomId);
    expect(getBackDoPassSequences(sequencesAfterRemount, actor.seatId)).toHaveLength(1);
  } finally {
    await guestContext.close().catch(() => undefined);
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
  }
}
