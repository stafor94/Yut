import { test, expect } from '@playwright/test';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import {
  attachConsoleErrorCapture,
  collectScreenState,
  createRoomFromLobby,
  expectNoBlockingConsoleErrors,
  primeLobbyStorage,
  primeTurnOrderResultQueues,
} from '../helpers/ui.js';
import {
  deleteRoomForQa,
  getRoomSequencesForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

const MAX_LOCAL_MOVE_START_DELAY_MS = 1_500;
const DELAYED_MOVE_ACK_MS = 2_500;
const ROLL_CASES = Object.freeze({
  do: Object.freeze({ name: '도', steps: 1, random: 0.1, finalNodeId: 'n02', path: ['n02'] }),
  gae: Object.freeze({ name: '개', steps: 2, random: 0.4, finalNodeId: 'n03', path: ['n02', 'n03'] }),
});

async function installAtomicHumanMoveQa(context, { moveAckDelayMs = 0, rollRandom = ROLL_CASES.gae.random } = {}) {
  await context.addInitScript(({ configuredMoveAckDelayMs, configuredRollRandom }) => {
    window.__YUT_QA_DELAY_MOVE_PIECE_ACTION_MS__ = configuredMoveAckDelayMs;
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
    window.__YUT_QA_ATOMIC_MOVE_TRACE__ = {
      readyAt: 0,
      clickAt: 0,
      settledPendingLocalRemoteActionCount: -1,
      movingStarts: [],
      nodeTransitions: [],
      selectedPieceIds: [],
      moveActionIds: [],
    };

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

    let previousMovingPieceId = '';
    let previousSelectedPieceId = '';
    const previousNodeIds = new Map();
    const actionIds = new Set();

    const sample = () => {
      const trace = window.__YUT_QA_ATOMIC_MOVE_TRACE__;
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const localSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
      const localPieces = Array.isArray(debug.pieces)
        ? debug.pieces.filter((piece) => piece?.ownerId === localSeatId)
        : [];
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      const moveReady = Boolean(localSeatId
        && debug.roll
        && moveButton instanceof HTMLButtonElement
        && !moveButton.disabled);
      const now = performance.now();

      if (moveReady && !trace.readyAt) trace.readyAt = now;
      if (moveReady && typeof debug.selectedPieceId === 'string' && debug.selectedPieceId && debug.selectedPieceId !== previousSelectedPieceId) {
        trace.selectedPieceIds.push(debug.selectedPieceId);
        previousSelectedPieceId = debug.selectedPieceId;
      }

      const movingPieceId = typeof debug.movingPieceId === 'string' ? debug.movingPieceId : '';
      if (movingPieceId && movingPieceId !== previousMovingPieceId) {
        trace.movingStarts.push({ pieceId: movingPieceId, at: now });
      }
      previousMovingPieceId = movingPieceId;

      for (const piece of localPieces) {
        const pieceId = String(piece?.id ?? '');
        const nodeId = String(piece?.nodeId ?? '');
        if (!pieceId || !nodeId) continue;
        if (!previousNodeIds.has(pieceId)) {
          previousNodeIds.set(pieceId, nodeId);
          continue;
        }
        const previousNodeId = previousNodeIds.get(pieceId);
        if (previousNodeId !== nodeId) {
          trace.nodeTransitions.push({ pieceId, fromNodeId: previousNodeId, nodeId, at: now });
          previousNodeIds.set(pieceId, nodeId);
        }
      }

      const mutationIds = Array.isArray(debug.actionPipeline?.localClientMutationIds)
        ? debug.actionPipeline.localClientMutationIds
        : [];
      for (const actionId of mutationIds) {
        if (typeof actionId !== 'string' || !actionId.startsWith(`move_piece:${localSeatId}:`)) continue;
        actionIds.add(actionId);
      }
      trace.moveActionIds = [...actionIds];
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { configuredMoveAckDelayMs: moveAckDelayMs, configuredRollRandom: rollRandom });
}

async function waitForHumanTurnReady(page) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    return Boolean(
      Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro
      && state.rollButton.visible
      && !state.rollButton.disabled,
    );
  }, {
    timeout: 50_000,
    intervals: [100, 250, 500],
    message: 'AI 1:1 순서 정하기가 끝나고 사람 플레이어가 첫 윷을 던질 수 있어야 합니다.',
  }).toBe(true);
}

async function openOnlineAiOneOnOneGame({ page, context, testInfo, suffix, moveAckDelayMs = 0, rollCase, stackedRollMode }) {
  await page.setViewportSize({ width: 412, height: 915 });
  const nickname = normalizeQaNickname(makeQaName(testInfo, `${suffix}-human`));
  const roomTitle = makeQaName(testInfo, `${suffix}-room`);

  await primeLobbyStorage(context, {
    nickname,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '2',
  });
  await context.addInitScript(({ enabled }) => {
    window.localStorage.setItem('yut-online:stackedRollMode', String(enabled));
  }, { enabled: stackedRollMode });
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await installAtomicHumanMoveQa(context, { moveAckDelayMs, rollRandom: rollCase.random });
  await createRoomFromLobby(page, roomTitle);
  const roomId = await rememberRoomIdFromPage(page);
  if (!roomId) throw new Error('AI 1:1 원자적 move-start QA 방 ID를 찾지 못했습니다.');

  const addAiButton = page.getByTestId('add-ai-P2');
  await expect(addAiButton).toBeVisible({ timeout: 15_000 });
  await addAiButton.click();
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('start-game-button').click();
  await waitForHumanTurnReady(page);

  const identity = await page.evaluate(() => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const localSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
    const ownedPieces = Array.isArray(debug.pieces)
      ? debug.pieces
        .filter((piece) => piece?.ownerId === localSeatId)
        .sort((left, right) => String(left?.label ?? '').localeCompare(String(right?.label ?? ''), undefined, { numeric: true }))
      : [];
    return {
      localSeatId,
      pieceId: String(ownedPieces[0]?.id ?? ''),
      otherPieceId: String(ownedPieces[1]?.id ?? ''),
      stackedRollMode: window.localStorage.getItem('yut-online:stackedRollMode') === 'true',
    };
  });
  expect(identity.localSeatId).not.toBe('');
  expect(identity.pieceId).not.toBe('');
  expect(identity.otherPieceId).not.toBe('');
  expect(identity.stackedRollMode).toBe(stackedRollMode);
  return { roomId, ...identity };
}

async function clickPerfectRoll(page, expectedRollName) {
  await page.evaluate(({ rollName }) => new Promise((resolve, reject) => {
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
        reject(new Error(`Perfect 구간에서 ${rollName} 윷 결과를 제출하지 못했습니다.`));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { rollName: expectedRollName });
}

async function clickMoveImmediatelyWhenReady(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const sample = () => {
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      if (moveButton instanceof HTMLButtonElement && !moveButton.disabled) {
        const trace = window.__YUT_QA_ATOMIC_MOVE_TRACE__;
        if (trace) trace.clickAt = performance.now();
        moveButton.click();
        resolve(undefined);
        return;
      }
      if (performance.now() - startedAt > 20_000) {
        reject(new Error('선택한 말 이동 버튼이 action-ready가 되지 않았습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function waitForMoveSettlement(page, pieceId, finalNodeId) {
  await expect.poll(() => page.evaluate(({ trackedPieceId }) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const piece = Array.isArray(debug.pieces)
      ? debug.pieces.find((candidate) => candidate?.id === trackedPieceId)
      : null;
    return {
      nodeId: String(piece?.nodeId ?? ''),
      moving: debug.movingPieceId === trackedPieceId,
      pending: Number(debug.pendingLocalRemoteActionCount ?? -1),
    };
  }, { trackedPieceId: pieceId }), {
    timeout: 25_000,
    intervals: [50, 100, 200, 400],
    message: `로컬 이동이 ${finalNodeId}에 정착하고 관련 pending이 0이 되어야 합니다.`,
  }).toEqual({ nodeId: finalNodeId, moving: false, pending: 0 });

  await expect.poll(() => page.evaluate(({ trackedPieceId, expectedNodeId }) => {
    const trace = window.__YUT_QA_ATOMIC_MOVE_TRACE__;
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const piece = Array.isArray(debug.pieces) ? debug.pieces.find((candidate) => candidate?.id === trackedPieceId) : null;
    const transitions = Array.isArray(trace?.nodeTransitions) ? trace.nodeTransitions.filter((entry) => entry?.pieceId === trackedPieceId) : [];
    const lastTransitionAt = Number(transitions[transitions.length - 1]?.at ?? 0);
    if (String(piece?.nodeId ?? '') !== expectedNodeId || debug.movingPieceId === trackedPieceId || Number(debug.pendingLocalRemoteActionCount ?? -1) !== 0 || !lastTransitionAt) return 0;
    if (trace) trace.settledPendingLocalRemoteActionCount = Number(debug.pendingLocalRemoteActionCount ?? -1);
    return performance.now() - lastTransitionAt;
  }, { trackedPieceId: pieceId, expectedNodeId: finalNodeId }), {
    timeout: 5_000,
    intervals: [100, 150, 200],
    message: 'ACK 이후에도 최종 위치가 유지되어 대기석/n01 복귀가 없어야 합니다.',
  }).toBeGreaterThanOrEqual(750);

  return page.evaluate(() => ({
    trace: window.__YUT_QA_ATOMIC_MOVE_TRACE__ ?? null,
    debug: window.__YUT_DEBUG_STATE__ ?? {},
  }));
}

function getMoveSequenceClientActionId(sequence) {
  return String(sequence?.action?.payload?.clientActionId ?? sequence?.clientMutationId ?? '');
}

async function expectPieceDomAtNode(page, pieceId, nodeId) {
  const geometry = await page.evaluate(({ trackedPieceId, expectedNodeId }) => {
    const piece = document.querySelector(`[data-testid="piece-${CSS.escape(trackedPieceId)}"]`);
    const node = document.querySelector(`[data-testid="board-node-${CSS.escape(expectedNodeId)}"]`);
    if (!(piece instanceof HTMLElement) || !(node instanceof HTMLElement)) return null;
    const pieceRect = piece.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    return {
      distance: Math.hypot(
        pieceRect.left + pieceRect.width / 2 - (nodeRect.left + nodeRect.width / 2),
        pieceRect.top + pieceRect.height / 2 - (nodeRect.top + nodeRect.height / 2),
      ),
    };
  }, { trackedPieceId: pieceId, expectedNodeId: nodeId });
  expect(geometry).not.toBeNull();
  expect(geometry.distance).toBeLessThanOrEqual(18);
}

async function expectAtomicMoveContract({ page, roomId, localSeatId, pieceId, otherPieceId, baselineSequence, startFromClick, rollCase }) {
  const observed = await waitForMoveSettlement(page, pieceId, rollCase.finalNodeId);
  const trace = observed.trace ?? {};
  const movingStarts = (trace.movingStarts ?? []).filter((entry) => entry?.pieceId === pieceId);
  const transitions = (trace.nodeTransitions ?? []).filter((entry) => entry?.pieceId === pieceId);
  const path = transitions.map((entry) => String(entry.nodeId ?? ''));
  const moveActionIds = (trace.moveActionIds ?? []).filter((actionId) => String(actionId).startsWith(`move_piece:${localSeatId}:`));
  const selectedPieceIds = (trace.selectedPieceIds ?? []).filter(Boolean);
  const startAt = Number(movingStarts[0]?.at ?? transitions[0]?.at ?? 0);
  const originAt = Number(startFromClick ? trace.clickAt : trace.readyAt);

  expect(originAt).toBeGreaterThan(0);
  expect(startAt).toBeGreaterThanOrEqual(originAt);
  expect(startAt - originAt).toBeLessThanOrEqual(MAX_LOCAL_MOVE_START_DELAY_MS);
  expect(movingStarts).toHaveLength(1);
  expect(path).toEqual(rollCase.path);
  expect(path.filter((nodeId) => nodeId === 'n01')).toHaveLength(0);
  expect(moveActionIds).toHaveLength(1);
  expect(selectedPieceIds.length).toBeGreaterThan(0);
  expect(selectedPieceIds.every((selectedId) => selectedId === pieceId)).toBe(true);

  const sequences = await getRoomSequencesForQa(roomId);
  const rollSequences = sequences.filter((sequence) => (
    Number(sequence?.sequence ?? 0) > baselineSequence
    && sequence?.type === 'roll_yut'
    && sequence?.actorId === localSeatId
  ));
  expect(rollSequences).toHaveLength(1);
  expect(String(rollSequences[0]?.payload?.rollName ?? rollSequences[0]?.patch?.roll?.name ?? '')).toBe(rollCase.name);
  expect(Number(rollSequences[0]?.payload?.rollSteps ?? rollSequences[0]?.patch?.roll?.steps ?? NaN)).toBe(rollCase.steps);

  const moveSequences = sequences.filter((sequence) => (
    Number(sequence?.sequence ?? 0) > baselineSequence
    && sequence?.type === 'move_piece_resolved'
    && sequence?.actorId === localSeatId
  ));
  expect(moveSequences).toHaveLength(1);
  expect(getMoveSequenceClientActionId(moveSequences[0])).toBe(moveActionIds[0]);
  expect(String(moveSequences[0]?.action?.payload?.pieceId ?? moveSequences[0]?.payload?.pieceId ?? '')).toBe(pieceId);
  const moveActionPayload = moveSequences[0]?.action?.payload ?? {};
  expect(moveActionPayload.recoveredByCoordinator).not.toBe(true);
  expect(moveActionPayload.timeoutRecoveredBy).toBeUndefined();
  expect(moveActionPayload.automationSource).toBeUndefined();
  expect(Number(moveActionPayload.clientActionStartedAt ?? 0)).toBeGreaterThan(0);

  const recoveryDiagnostics = Array.isArray(observed.debug?.remoteActionDiagnostics)
    ? observed.debug.remoteActionDiagnostics.filter((entry) => /stalled-turn-recovery|timeout-recovery/i.test(String(entry?.stage ?? '')))
    : [];
  expect(recoveryDiagnostics).toEqual([]);

  const serverState = await getRoomStateForQa(roomId);
  const serverPiece = (serverState?.pieces ?? []).find((piece) => piece?.id === pieceId);
  const serverOtherPiece = (serverState?.pieces ?? []).find((piece) => piece?.id === otherPieceId);
  const debugPiece = (observed.debug?.pieces ?? []).find((piece) => piece?.id === pieceId);
  const debugOtherPiece = (observed.debug?.pieces ?? []).find((piece) => piece?.id === otherPieceId);
  expect(serverPiece).toMatchObject({ nodeId: rollCase.finalNodeId, started: true, finished: false });
  expect(debugPiece).toMatchObject({ nodeId: rollCase.finalNodeId, started: true, finished: false });
  expect(serverOtherPiece).toMatchObject({ nodeId: 'n01', started: false, finished: false });
  expect(debugOtherPiece).toMatchObject({ nodeId: 'n01', started: false, finished: false });
  expect(Number(trace.settledPendingLocalRemoteActionCount ?? -1)).toBe(0);
  await expectPieceDomAtNode(page, pieceId, rollCase.finalNodeId);
  return { moveActionId: moveActionIds[0] };
}

async function getLastSequence(roomId) {
  const sequences = await getRoomSequencesForQa(roomId);
  return sequences.reduce((max, sequence) => Math.max(max, Number(sequence?.sequence ?? 0)), 0);
}

async function scheduleReloadAtMoveReady(page) {
  const navigation = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 20_000,
  });
  await page.evaluate(() => {
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      if (moveButton instanceof HTMLButtonElement && !moveButton.disabled) {
        const localSeatId = String(debug.localSeatId ?? '');
        const moveActionIds = Array.isArray(debug.actionPipeline?.localClientMutationIds)
          ? debug.actionPipeline.localClientMutationIds.filter((actionId) => typeof actionId === 'string' && actionId.startsWith(`move_piece:${localSeatId}:`))
          : [];
        const localPieces = Array.isArray(debug.pieces)
          ? debug.pieces.filter((piece) => piece?.ownerId === localSeatId).map((piece) => ({ id: piece.id, nodeId: piece.nodeId, started: piece.started, finished: piece.finished }))
          : [];
        sessionStorage.setItem('yut-qa-atomic-move-reload-prestate', JSON.stringify({
          roll: debug.roll ?? null,
          pendingLocalRemoteActionCount: Number(debug.pendingLocalRemoteActionCount ?? -1),
          moveActionIds,
          localPieces,
        }));
        window.location.reload();
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await navigation;
  await page.waitForLoadState('domcontentloaded');
}

async function runMoveScenario({ page, context, testInfo, suffix, rollCase, manual, stackedRollMode, moveAckDelayMs }) {
  const consoleErrors = [];
  attachConsoleErrorCapture(page, consoleErrors);
  const game = await openOnlineAiOneOnOneGame({ page, context, testInfo, suffix, moveAckDelayMs, rollCase, stackedRollMode });
  const baselineSequence = await getLastSequence(game.roomId);
  const clickPromise = manual ? clickMoveImmediatelyWhenReady(page) : null;
  await clickPerfectRoll(page, rollCase.name);
  if (clickPromise) await clickPromise;
  await expectAtomicMoveContract({
    page,
    roomId: game.roomId,
    localSeatId: game.localSeatId,
    pieceId: game.pieceId,
    otherPieceId: game.otherPieceId,
    baselineSequence,
    startFromClick: manual,
    rollCase,
  });
  expectNoBlockingConsoleErrors(consoleErrors);
  return game;
}

test.describe('AI 1:1 human atomic move start', () => {
  test.setTimeout(150_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('AI 1:1 2말 도 출발점 자동 OFF 정상 ACK: lowest-label 말을 1.5초 안에 n02로 한 번만 이동한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 move-start 회귀에서만 실행합니다.');
    const game = await runMoveScenario({ page, context, testInfo, suffix: 'atomic-do-auto-off', rollCase: ROLL_CASES.do, manual: false, stackedRollMode: false, moveAckDelayMs: 0 });
    roomId = game.roomId;
  });

  test('AI 1:1 2말 도 수동 ACK ON 지연 ACK: 버튼 즉시 입력으로 n02 이동을 한 번만 시작한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 move ACK 회귀에서만 실행합니다.');
    const game = await runMoveScenario({ page, context, testInfo, suffix: 'atomic-do-manual-on', rollCase: ROLL_CASES.do, manual: true, stackedRollMode: true, moveAckDelayMs: DELAYED_MOVE_ACK_MS });
    roomId = game.roomId;
  });

  test('AI 1:1 2말 개 출발점 자동 ON 정상 ACK: lowest-label 말을 1.5초 안에 n03로 한 번만 이동한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 move-start 회귀에서만 실행합니다.');
    const game = await runMoveScenario({ page, context, testInfo, suffix: 'atomic-gae-auto-on', rollCase: ROLL_CASES.gae, manual: false, stackedRollMode: true, moveAckDelayMs: 0 });
    roomId = game.roomId;
  });

  test('AI 1:1 2말 개 수동 ACK OFF 지연 ACK: 선택한 말 이동을 즉시 시작하고 한 번만 commit한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 move ACK 회귀에서만 실행합니다.');
    const game = await runMoveScenario({ page, context, testInfo, suffix: 'atomic-gae-manual-off', rollCase: ROLL_CASES.gae, manual: true, stackedRollMode: false, moveAckDelayMs: DELAYED_MOVE_ACK_MS });
    roomId = game.roomId;
  });

  test('AI 1:1 2말 개 출발점 reload OFF 지연 ACK: move-ready authoritative 상태를 새로고침해도 동일 logical move를 한 번만 실행한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 reload move-start 회귀에서만 실행합니다.');
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    const game = await openOnlineAiOneOnOneGame({ page, context, testInfo, suffix: 'atomic-reload-start', moveAckDelayMs: DELAYED_MOVE_ACK_MS, rollCase: ROLL_CASES.gae, stackedRollMode: false });
    roomId = game.roomId;
    const baselineSequence = await getLastSequence(roomId);

    await clickPerfectRoll(page, ROLL_CASES.gae.name);
    await scheduleReloadAtMoveReady(page);
    const preReload = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yut-qa-atomic-move-reload-prestate') ?? '{}'));
    expect(preReload.roll).toMatchObject({ name: '개', steps: 2 });
    expect(preReload.pendingLocalRemoteActionCount).toBe(0);
    expect(preReload.moveActionIds).toEqual([]);
    expect(preReload.localPieces).toHaveLength(2);
    expect(preReload.localPieces.every((piece) => piece.nodeId === 'n01' && piece.started === false && piece.finished === false)).toBe(true);

    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expectAtomicMoveContract({
      page,
      roomId,
      localSeatId: game.localSeatId,
      pieceId: game.pieceId,
      otherPieceId: game.otherPieceId,
      baselineSequence,
      startFromClick: false,
      rollCase: ROLL_CASES.gae,
    });
    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
