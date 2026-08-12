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
import { deleteRoomForQa, getRoomSequencesForQa, getRoomStateForQa } from '../helpers/rooms.js';
import { seedRoomPieceAtNodeForQa } from '../helpers/room-state-fixture.js';

const TURN_ACTION_TIMEOUT_MS = 10_000;
const POSITION_PROPERTIES = ['left', 'top', 'translate'];

test.setTimeout(120_000);

async function installDeterministicHumanClient(context, { turnOrderResult, rollRandom = 0.6 }) {
  await context.addInitScript(({ queuedTurnOrderResult, configuredRollRandom }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = [queuedTurnOrderResult];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    const nativeRandom = Math.random;
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
      if (document.querySelector('.turn-order-overlay')) return;
      Math.random = () => configuredRollRandom;
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
  }, { queuedTurnOrderResult: turnOrderResult, configuredRollRandom: rollRandom });
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
  }, { timeout: 50_000, message: '두 플레이어의 순서 결정과 현재 actor 입력 가능 상태가 준비되어야 합니다.' }).toBe(true);
}

async function resolveCurrentActor(hostPage, guestPage) {
  await expect.poll(async () => {
    const [host, guest] = await Promise.all([collectScreenState(hostPage), collectScreenState(guestPage)]);
    if (host.rollButton.visible && !host.rollButton.disabled) return 'host';
    if (guest.rollButton.visible && !guest.rollButton.disabled) return 'guest';
    return '';
  }, {
    timeout: 20_000,
    message: '순서 결정 결과의 실제 current actor가 roll action을 수행할 수 있어야 합니다.',
  }).toMatch(/^(host|guest)$/);

  const host = await collectScreenState(hostPage);
  const hostActs = host.rollButton.visible && !host.rollButton.disabled;
  return hostActs
    ? { actorPage: hostPage, targetPage: guestPage }
    : { actorPage: guestPage, targetPage: hostPage };
}

async function openCaptureGame({ browser, page, context, testInfo }) {
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  const guestContext = await browser.newContext({ viewport });
  const guestPage = await guestContext.newPage();
  let roomId = '';
  try {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'capture-arrival-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'capture-arrival-guest'));
    const roomTitle = makeQaName(testInfo, 'capture-arrival-room');
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
    await installDeterministicHumanClient(context, { turnOrderResult: '모', rollRandom: 0.6 });
    await installDeterministicHumanClient(guestContext, { turnOrderResult: '도', rollRandom: 0.6 });

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await joinRoomFromLobby(guestPage, roomTitle);
    await markGuestReady(guestPage);
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await Promise.all([waitForGameReady(page), waitForGameReady(guestPage)]);
    const { actorPage, targetPage } = await resolveCurrentActor(page, guestPage);
    return { roomId, hostPage: page, hostContext: context, guestPage, guestContext, actorPage, targetPage };
  } catch (error) {
    await guestContext.close().catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
    throw error;
  }
}

async function getOwnedPieceIdentity(page) {
  return page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const ownerSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const piece = Array.isArray(debug.pieces)
      ? debug.pieces.find((candidate) => candidate?.ownerId === ownerSeatId)
      : null;
    return { ownerSeatId, pieceId: typeof piece?.id === 'string' ? piece.id : '' };
  });
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

async function waitForSeededPiece(page, pieceId, nodeId) {
  await expect.poll(() => page.evaluate(({ targetPieceId, expectedNodeId }) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    return Array.isArray(debug.pieces)
      && debug.pieces.find((piece) => piece?.id === targetPieceId)?.nodeId === expectedNodeId;
  }, { targetPieceId: pieceId, expectedNodeId: nodeId }), { timeout: 20_000 }).toBe(true);
}

async function installCaptureOrderObserver(page, attackerPieceId, capturedPieceId) {
  await page.evaluate(({ attackerId, capturedId, positionProperties }) => {
    const trace = {
      finalTransitionStartedAt: 0,
      finalTransitionEndedAt: 0,
      captureStartedAt: 0,
      sourceHiddenAt: 0,
      ghostStartedAt: 0,
      captureStartCount: 0,
      prematureCapture: false,
      activeFinalProperties: [],
      captureVisible: false,
    };
    window.__YUT_CAPTURE_ORDER_TRACE__ = trace;
    const activeProperties = new Set();
    const isPositionProperty = (propertyName) => positionProperties.includes(propertyName);
    const isFinalAttacker = (target) => target instanceof HTMLElement
      && target.matches(`[data-testid="piece-${attackerId}"]`)
      && target.classList.contains('capture-approach');

    document.addEventListener('transitionrun', (event) => {
      if (!isFinalAttacker(event.target) || !isPositionProperty(event.propertyName)) return;
      activeProperties.add(event.propertyName);
      trace.activeFinalProperties = [...activeProperties];
      if (!trace.finalTransitionStartedAt) trace.finalTransitionStartedAt = performance.now();
    }, true);
    document.addEventListener('transitionend', (event) => {
      if (!isFinalAttacker(event.target) || !isPositionProperty(event.propertyName)) return;
      activeProperties.delete(event.propertyName);
      trace.activeFinalProperties = [...activeProperties];
      if (trace.finalTransitionStartedAt && activeProperties.size === 0 && !trace.finalTransitionEndedAt) {
        trace.finalTransitionEndedAt = performance.now();
      }
    }, true);

    const sampleCaptureDom = () => {
      const source = document.querySelector(`[data-testid="piece-${capturedId}"]`);
      const hidden = source instanceof HTMLElement
        && (source.classList.contains('capture-source-hidden') || getComputedStyle(source).visibility === 'hidden');
      const ghostCount = document.querySelectorAll('.capture-ghost').length;
      const impactCount = document.querySelectorAll('.capture-impact-wave').length;
      const boardShaking = document.querySelector('[data-testid="game-board"]')?.classList.contains('capture-shake') ?? false;
      const captureVisible = hidden || ghostCount > 0 || impactCount > 0 || boardShaking;
      if (hidden && !trace.sourceHiddenAt) trace.sourceHiddenAt = performance.now();
      if (ghostCount > 0 && !trace.ghostStartedAt) trace.ghostStartedAt = performance.now();
      if (captureVisible && !trace.captureVisible) {
        trace.captureStartCount += 1;
        trace.captureStartedAt = performance.now();
        if (!trace.finalTransitionEndedAt) trace.prematureCapture = true;
      }
      trace.captureVisible = captureVisible;
    };
    const observer = new MutationObserver(sampleCaptureDom);
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sampleCaptureDom();
  }, { attackerId: attackerPieceId, capturedId: capturedPieceId, positionProperties: POSITION_PROPERTIES });
}

async function getCaptureTrace(page) {
  return page.evaluate(() => ({ ...(window.__YUT_CAPTURE_ORDER_TRACE__ ?? {}) }));
}

async function getRenderedNodeId(page, pieceId) {
  return page.evaluate((targetPieceId) => {
    const pieceElement = document.querySelector(`[data-testid="piece-${targetPieceId}"]`);
    if (!(pieceElement instanceof HTMLElement) || pieceElement.classList.contains('off-board')) return 'n01';
    const nodeElement = [...document.querySelectorAll('[data-testid^="board-node-"]')]
      .find((candidate) => candidate instanceof HTMLElement
        && candidate.style.left === pieceElement.style.left
        && candidate.style.top === pieceElement.style.top);
    return nodeElement?.getAttribute('data-testid')?.replace('board-node-', '') ?? '';
  }, pieceId);
}

function getCapturedIdsFromMoveSequence(sequence) {
  const candidates = [
    sequence?.payload?.capturedPieceIds,
    sequence?.action?.payload?.capturedPieceIds,
    sequence?.patch?.capturedPieceIds,
    sequence?.result?.capturedPieceIds,
  ];
  const explicitCapturedIds = candidates.find(Array.isArray);
  if (Array.isArray(explicitCapturedIds)) return explicitCapturedIds.map(String);

  const movingGroupIds = new Set(Array.isArray(sequence?.payload?.movingGroupIds)
    ? sequence.payload.movingGroupIds.map(String)
    : []);
  const patchedPieces = Array.isArray(sequence?.patch?.pieces) ? sequence.patch.pieces : [];
  return patchedPieces
    .filter((piece) => piece
      && !movingGroupIds.has(String(piece.id ?? ''))
      && piece.nodeId === 'n01'
      && piece.started === false
      && piece.finished === false)
    .map((piece) => String(piece.id ?? ''))
    .filter(Boolean);
}

test('잡기 source/ghost는 공격 말의 실제 마지막 transitionend 뒤에만 시작된다', async ({ browser, page, context }, testInfo) => {
  let game;
  try {
    game = await openCaptureGame({ browser, page, context, testInfo });
    const attacker = await getOwnedPieceIdentity(game.actorPage);
    const target = await getOwnedPieceIdentity(game.targetPage);
    expect(attacker.ownerSeatId).not.toBe('');
    expect(attacker.pieceId).not.toBe('');
    expect(target.ownerSeatId).not.toBe('');
    expect(target.pieceId).not.toBe('');

    await seedRoomPieceAtNodeForQa({
      roomId: game.roomId,
      authPage: game.hostPage,
      ownerSeatId: target.ownerSeatId,
      pieceId: target.pieceId,
      nodeId: 'n19',
      previousNodeId: 'n18',
    });
    await seedRoomPieceAtNodeForQa({
      roomId: game.roomId,
      authPage: game.hostPage,
      ownerSeatId: attacker.ownerSeatId,
      pieceId: attacker.pieceId,
      nodeId: 'n16',
      previousNodeId: 'n15',
      turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
    });
    await Promise.all([game.hostPage.reload(), game.guestPage.reload()]);
    await Promise.all([
      waitForGameReady(game.actorPage, { expectRollEnabled: true }),
      waitForGameReady(game.targetPage),
      waitForSeededPiece(game.actorPage, attacker.pieceId, 'n16'),
      waitForSeededPiece(game.actorPage, target.pieceId, 'n19'),
    ]);

    const capturedSource = game.actorPage.getByTestId(`piece-${target.pieceId}`);
    await expect(capturedSource).toBeVisible();
    await expect(capturedSource).not.toHaveClass(/capture-source-hidden/);
    await expect(game.actorPage.locator('.capture-ghost')).toHaveCount(0);
    await installCaptureOrderObserver(game.actorPage, attacker.pieceId, target.pieceId);

    await seedRoomPieceAtNodeForQa({
      roomId: game.roomId,
      authPage: game.hostPage,
      ownerSeatId: attacker.ownerSeatId,
      pieceId: attacker.pieceId,
      nodeId: 'n16',
      previousNodeId: 'n15',
      turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS,
    });
    await waitForSeededPiece(game.actorPage, attacker.pieceId, 'n16');

    const baselineSequences = await getRoomSequencesForQa(game.roomId);
    await clickPerfectRoll(game.actorPage);
    await expect(game.actorPage.getByTestId('move-piece-button')).toBeEnabled({ timeout: 20_000 });
    await game.actorPage.getByTestId('move-piece-button').click();

    await expect.poll(async () => (await getCaptureTrace(game.actorPage)).finalTransitionStartedAt, {
      timeout: 20_000,
      message: 'capture-approach의 실제 positional transition이 시작되어야 합니다.',
    }).toBeGreaterThan(0);
    await expect.poll(async () => (await getCaptureTrace(game.actorPage)).captureStartCount, {
      timeout: 20_000,
      message: 'attacker 도착 뒤 capture presentation이 한 번 시작되어야 합니다.',
    }).toBe(1);

    const trace = await getCaptureTrace(game.actorPage);
    expect(trace.prematureCapture).toBe(false);
    expect(trace.finalTransitionEndedAt).toBeGreaterThanOrEqual(trace.finalTransitionStartedAt);
    expect(trace.captureStartedAt).toBeGreaterThanOrEqual(trace.finalTransitionEndedAt);
    expect(trace.sourceHiddenAt).toBeGreaterThanOrEqual(trace.finalTransitionEndedAt);
    expect(trace.ghostStartedAt).toBeGreaterThanOrEqual(trace.finalTransitionEndedAt);
    expect(trace.captureStartCount).toBe(1);

    await expect.poll(() => game.actorPage.evaluate(({ attackerId, capturedId }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const attackerPiece = Array.isArray(debug.pieces) ? debug.pieces.find((piece) => piece?.id === attackerId) : null;
      const capturedPiece = Array.isArray(debug.pieces) ? debug.pieces.find((piece) => piece?.id === capturedId) : null;
      return Boolean(attackerPiece?.nodeId === 'n19'
        && attackerPiece?.started
        && capturedPiece?.nodeId === 'n01'
        && !capturedPiece?.started
        && !debug.movingPieceId);
    }, { attackerId: attacker.pieceId, capturedId: target.pieceId }), {
      timeout: 25_000,
      message: 'capture 종료 뒤 authoritative debug state가 목적지/대기석으로 정착해야 합니다.',
    }).toBe(true);

    const sequences = await getRoomSequencesForQa(game.roomId);
    const moveSequences = sequences.filter((sequence) => sequence?.type === 'move_piece_resolved'
      && sequence?.actorId === attacker.ownerSeatId);
    expect(moveSequences).toHaveLength(1);
    expect(getCapturedIdsFromMoveSequence(moveSequences[0])).toEqual([target.pieceId]);
    expect(sequences.length).toBeGreaterThan(baselineSequences.length);

    const serverState = await getRoomStateForQa(game.roomId);
    const serverAttacker = serverState?.pieces?.find((piece) => piece?.id === attacker.pieceId);
    const serverCaptured = serverState?.pieces?.find((piece) => piece?.id === target.pieceId);
    expect(serverAttacker?.nodeId).toBe('n19');
    expect(serverAttacker?.started).toBe(true);
    expect(serverCaptured?.nodeId).toBe('n01');
    expect(serverCaptured?.started).toBe(false);
    expect(await getRenderedNodeId(game.actorPage, attacker.pieceId)).toBe('n19');
    await expect(game.actorPage.getByTestId(`piece-${target.pieceId}`)).toHaveClass(/off-board/);

    await expect.poll(async () => {
      const host = await collectScreenState(game.hostPage);
      const guest = await collectScreenState(game.guestPage);
      return (host.rollButton.visible && !host.rollButton.disabled)
        || (guest.rollButton.visible && !guest.rollButton.disabled);
    }, { timeout: 20_000, message: 'capture settlement 뒤 authoritative next action actor가 정상 진행 가능해야 합니다.' }).toBe(true);
  } finally {
    if (game) {
      await game.guestContext.close().catch(() => undefined);
      await deleteRoomForQa(game.roomId).catch(() => undefined);
    }
  }
});
