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
import { bumpRoomStateTurnVersionForQa } from '../helpers/room-state-fixture.js';

async function installDeterministicHumanClient(context, { turnOrderResult, moveResultDelayMs = 0 }) {
  await context.addInitScript(({ queuedTurnOrderResult, configuredMoveResultDelayMs }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
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
  }, { timeout: 50_000 }).toBe(true);
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
      if (performance.now() - startedAt > 15_000) {
        reject(new Error('Perfect roll 입력 가능 구간을 찾지 못했습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function openGuestTurnGame({ browser, page, context, testInfo, suffix, moveResultDelayMs }) {
  await page.setViewportSize({ width: 412, height: 915 });
  const guestContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestPage = await guestContext.newPage();
  let roomId = '';
  try {
    const hostName = normalizeQaNickname(makeQaName(testInfo, `${suffix}-host`));
    const guestName = normalizeQaNickname(makeQaName(testInfo, `${suffix}-guest`));
    const roomTitle = makeQaName(testInfo, `${suffix}-room`);
    await primeLobbyStorage(context, {
      nickname: hostName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '2',
    });
    await primeLobbyStorage(guestContext, {
      nickname: guestName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '2',
    });
    await installDeterministicHumanClient(context, { turnOrderResult: '도', moveResultDelayMs: 0 });
    await installDeterministicHumanClient(guestContext, { turnOrderResult: '모', moveResultDelayMs });
    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await Promise.all([
      waitForGameReady(guestPage, { expectRollEnabled: true }),
      waitForGameReady(page),
    ]);
    return { roomId, guestContext, guestPage, hostPage: page };
  } catch (error) {
    await guestContext.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
    throw error;
  }
}

async function getGuestPieceIdentity(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const ownerSeatId = String(debug.localSeatId ?? '');
    const pieces = Array.isArray(debug.pieces)
      ? debug.pieces
        .filter((piece) => piece?.ownerId === ownerSeatId)
        .sort((left, right) => String(left?.label ?? '').localeCompare(String(right?.label ?? ''), undefined, { numeric: true }))
      : [];
    return {
      ownerSeatId,
      lowestId: String(pieces[0]?.id ?? ''),
      otherId: String(pieces[1]?.id ?? ''),
    };
  });
}

async function expectPieceConvergence(executorPage, observerPage, identity) {
  await expect.poll(async () => Promise.all([executorPage, observerPage].map((targetPage) => targetPage.evaluate(({ lowestId, otherId }) => {
    const pieces = window.__YUT_DEBUG_STATE__?.pieces ?? [];
    return [lowestId, otherId].map((pieceId) => {
      const piece = pieces.find((candidate) => candidate?.id === pieceId);
      return { id: pieceId, nodeId: piece?.nodeId ?? '', started: Boolean(piece?.started), finished: Boolean(piece?.finished) };
    });
  }, identity))), {
    timeout: 20_000,
    intervals: [100, 250, 500],
  }).toEqual([
    [
      { id: identity.lowestId, nodeId: 'n04', started: true, finished: false },
      { id: identity.otherId, nodeId: 'n01', started: false, finished: false },
    ],
    [
      { id: identity.lowestId, nodeId: 'n04', started: true, finished: false },
      { id: identity.otherId, nodeId: 'n01', started: false, finished: false },
    ],
  ]);
}

async function expectSingleResolvedMove(roomId, actorId) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    return sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && String(sequence?.clientMutationId ?? '').startsWith(`move_piece:${actorId}:`)).length;
  }, { timeout: 20_000, intervals: [100, 250, 500] }).toBe(1);
}

test.describe('Galaxy durable auto move and move timer pending', () => {
  let roomId = '';
  let guestContext;

  test.afterEach(async () => {
    await guestContext?.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
    guestContext = undefined;
    roomId = '';
  });

  test('guest의 걸 출발점 자동 이동은 snapshot 재렌더에도 lowest-label 말을 정확히 한 번만 n01→n02→n03→n04 이동한다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const game = await openGuestTurnGame({ browser, page, context, testInfo, suffix: 'guest-gul-auto-snapshot', moveResultDelayMs: 0 });
    roomId = game.roomId;
    guestContext = game.guestContext;
    const identity = await getGuestPieceIdentity(game.guestPage);
    expect(identity.lowestId).not.toBe('');
    expect(identity.otherId).not.toBe('');

    await clickPerfectRoll(game.guestPage);
    await expect.poll(() => game.guestPage.evaluate(({ lowestId }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const piece = Array.isArray(debug.pieces)
        ? debug.pieces.find((candidate) => candidate?.id === lowestId)
        : undefined;
      return {
        turnDeadlineKind: String(debug.turnDeadlineKind ?? ''),
        movingPieceId: String(debug.movingPieceId ?? ''),
        nodeId: String(piece?.nodeId ?? ''),
      };
    }, { lowestId: identity.lowestId }), {
      timeout: 20_000,
      intervals: [20, 50, 100],
    }).toEqual({ turnDeadlineKind: 'move', movingPieceId: '', nodeId: 'n01' });
    await bumpRoomStateTurnVersionForQa({ roomId, authPage: game.hostPage });

    await expectPieceConvergence(game.guestPage, game.hostPage, identity);
    await expectSingleResolvedMove(roomId, identity.ownerSeatId);
  });

  test('느린 move ACK 동안 제출 pending은 이동 버튼을 잠그고 turn-action-timer를 ACK까지 숨긴다', async ({ browser, page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(150_000);
    const game = await openGuestTurnGame({ browser, page, context, testInfo, suffix: 'guest-gul-slow-ack-timer', moveResultDelayMs: 2_500 });
    roomId = game.roomId;
    guestContext = game.guestContext;
    const identity = await getGuestPieceIdentity(game.guestPage);

    await clickPerfectRoll(game.guestPage);
    const moveButton = game.guestPage.getByTestId('move-piece-button');
    await expect(moveButton).toBeEnabled({ timeout: 20_000 });
    await expect(game.guestPage.locator('.turn-action-timer')).toHaveCount(1);
    await game.guestPage.evaluate(() => {
      window.setTimeout(() => {
        const button = document.querySelector('[data-testid="move-piece-button"]');
        if (button instanceof HTMLButtonElement && !button.disabled) button.click();
      }, 450);
    });

    await expect.poll(() => game.guestPage.evaluate(() => String(window.__YUT_DEBUG_STATE__?.movingPieceId ?? '')), {
      timeout: 10_000,
      intervals: [50, 100, 250],
    }).toBe(identity.lowestId);
    await expect(moveButton).toBeDisabled();
    await expect(game.guestPage.locator('.turn-action-timer')).toHaveCount(0);
    await game.guestPage.waitForTimeout(1_200);
    await expect(game.guestPage.locator('.turn-action-timer')).toHaveCount(0);

    await expectPieceConvergence(game.guestPage, game.hostPage, identity);
    await expectSingleResolvedMove(roomId, identity.ownerSeatId);
  });
});
