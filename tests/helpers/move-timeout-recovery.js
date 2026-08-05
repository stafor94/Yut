import { expect } from '@playwright/test';
import { makeTimeoutActionKey } from '../../src/features/room/services/timeoutResolvers.ts';
import { readFirebaseAccessTokenFromIndexedDb } from './browser-auth-token.js';
import { makeQaName, normalizeQaNickname } from './env.js';
import {
  createRoomFromLobby,
  collectScreenState,
  expectAppShell,
  primeLobbyStorage,
  primeTurnOrderResultQueues,
} from './ui.js';
import {
  findRoomIdByTitle,
  getRoomSequencesForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from './rooms.js';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';

const VISIBLE_FIXTURE_DEADLINE_OFFSET_MS = 9_000;
const INITIAL_TIMEOUT_COUNT = 1;
const EXPECTED_TIMEOUT_COUNT = INITIAL_TIMEOUT_COUNT + 1;

const commitRoomStatePatchForQa = (page, roomId, patch, actorId, options = {}) => commitAuthoritativeStatePatchForQa(
  page,
  roomId,
  patch,
  actorId,
  {
    fixtureName: 'move-timeout-recovery',
    errorLabel: 'normal move timeout fixture',
    ...options,
  },
);

const getMoveSequencesAfter = (sequences, baselineSequence, actorId) => sequences.filter((sequence) => (
  Number(sequence.sequence ?? 0) > Number(baselineSequence ?? 0)
  && sequence.type === 'move_piece_resolved'
  && sequence.action?.type === 'move_piece'
  && sequence.action?.actorId === actorId
));

const getPieceById = (pieces, pieceId) => (
  Array.isArray(pieces) ? pieces.find((piece) => piece?.id === pieceId) : undefined
);

async function startMovePresentationTrace(page, targetPieceId) {
  await page.evaluate((pieceId) => {
    const findPieceElement = () => Array.from(document.querySelectorAll('[data-testid^="piece-"]'))
      .find((node) => node.getAttribute('data-testid') === `piece-${pieceId}`);
    const trace = {
      targetPieceId: pieceId,
      movingStarts: 0,
      benchReturns: 0,
      nodePath: [],
      appliedSequencePath: [],
      captureGhostMax: 0,
      seenPresentation: false,
      lastMovingPieceId: '',
      lastAtBench: true,
      lastSignature: '',
      samples: [],
    };
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const piece = Array.isArray(debug.pieces)
        ? debug.pieces.find((candidate) => candidate?.id === pieceId)
        : undefined;
      const movingPieceId = typeof debug.movingPieceId === 'string' ? debug.movingPieceId : '';
      const pieceElement = findPieceElement();
      const offBoard = pieceElement instanceof HTMLElement && pieceElement.classList.contains('off-board');
      const captureGhostCount = document.querySelectorAll('.capture-ghost').length;
      const lastAppliedSequence = Number(debug.lastAppliedSequence ?? 0);

      if (movingPieceId === pieceId && trace.lastMovingPieceId !== pieceId) trace.movingStarts += 1;
      const presentedOnBoard = Boolean(piece && (piece.started || movingPieceId === pieceId || !offBoard));
      if (presentedOnBoard) trace.seenPresentation = true;
      const atBench = Boolean(piece && !piece.started && !piece.finished && offBoard && movingPieceId !== pieceId);
      if (trace.seenPresentation && atBench && !trace.lastAtBench) trace.benchReturns += 1;
      if (presentedOnBoard && typeof piece?.nodeId === 'string' && trace.nodePath.at(-1) !== piece.nodeId) {
        trace.nodePath.push(piece.nodeId);
      }
      if (lastAppliedSequence > 0 && trace.appliedSequencePath.at(-1) !== lastAppliedSequence) {
        trace.appliedSequencePath.push(lastAppliedSequence);
      }
      trace.captureGhostMax = Math.max(trace.captureGhostMax, captureGhostCount);

      const signature = [
        movingPieceId,
        piece?.nodeId ?? '',
        piece?.started === true ? 'started' : 'bench',
        offBoard ? 'off-board' : 'on-board',
        lastAppliedSequence,
        captureGhostCount,
      ].join('|');
      if (signature !== trace.lastSignature && trace.samples.length < 120) {
        trace.samples.push({
          at: Date.now(),
          movingPieceId,
          nodeId: piece?.nodeId ?? '',
          started: piece?.started === true,
          offBoard,
          lastAppliedSequence,
          captureGhostCount,
        });
        trace.lastSignature = signature;
      }
      trace.lastMovingPieceId = movingPieceId;
      trace.lastAtBench = atBench;
    };

    window.__YUT_TIMEOUT_MOVE_TRACE__ = trace;
    sample();
    window.__YUT_TIMEOUT_MOVE_TRACE_TIMER__ = window.setInterval(sample, 20);
  }, targetPieceId);
}

async function stopMovePresentationTrace(page) {
  return page.evaluate(() => {
    const timer = window.__YUT_TIMEOUT_MOVE_TRACE_TIMER__;
    if (typeof timer === 'number') window.clearInterval(timer);
    window.__YUT_TIMEOUT_MOVE_TRACE_TIMER__ = undefined;
    const trace = window.__YUT_TIMEOUT_MOVE_TRACE__ ?? null;
    if (!trace?.targetPieceId) return { trace, finalDom: null };

    const pieceElement = Array.from(document.querySelectorAll('[data-testid^="piece-"]'))
      .find((node) => node.getAttribute('data-testid') === `piece-${trace.targetPieceId}`);
    const pieceRect = pieceElement instanceof HTMLElement ? pieceElement.getBoundingClientRect() : null;
    const pieceCenter = pieceRect
      ? { x: pieceRect.left + pieceRect.width / 2, y: pieceRect.top + pieceRect.height / 2 }
      : null;
    const nearestNode = pieceCenter
      ? Array.from(document.querySelectorAll('[data-testid^="board-node-"]'))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return {
            nodeId: node.getAttribute('data-testid')?.replace('board-node-', '') ?? '',
            distance: Math.hypot(pieceCenter.x - x, pieceCenter.y - y),
          };
        })
        .sort((left, right) => left.distance - right.distance)[0]
      : null;
    return {
      trace,
      finalDom: {
        offBoard: pieceElement instanceof HTMLElement && pieceElement.classList.contains('off-board'),
        nearestNodeId: nearestNode?.nodeId ?? '',
        nearestNodeDistance: nearestNode?.distance ?? Number.POSITIVE_INFINITY,
        captureGhostCount: document.querySelectorAll('.capture-ghost').length,
      },
    };
  });
}

export async function expectMoveTimeoutRecoveryUiProgress(page, { message }) {
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const gameScreen = document.querySelector('[data-testid="game-screen"]');
    const playControls = document.querySelector('[data-testid="play-controls"]');
    const moveButton = document.querySelector('[data-testid="move-piece-button"]');
    const isRendered = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const staleMoveButtonLocked = isRendered(moveButton) && moveButton.hasAttribute('disabled');
    return isRendered(gameScreen) && Boolean(playControls) && !staleMoveButtonLocked;
  }), {
    timeout: 8_000,
    intervals: [100, 200, 400],
    message,
  }).toBe(true);
}

export async function prepareMoveTimeoutRecoveryFixture({ page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'movehost'));
  const roomTitle = makeQaName(testInfo, 'move-timeout-room');
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('yut-online:stackedRollMode', 'false');
  });
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await createRoomFromLobby(page, roomTitle);
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('normal move timeout QA 방 ID를 찾지 못했습니다.');

  const addAiButton = page.getByTestId('add-ai-P2');
  if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const screen = await collectScreenState(page);
    return Boolean(
      !screen.yutDebug?.turnOrderPhase?.active
      && !screen.yutDebug?.turnOrderIntro
      && Array.isArray(screen.yutDebug?.turnOrderIds)
      && screen.yutDebug.turnOrderIds.length >= 2,
    );
  }, { timeout: 40_000, message: '순서 정하기 완료 후 normal move timeout fixture를 주입해야 합니다.' }).toBe(true);

  await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    return Boolean(
      state
      && Array.isArray(state.turnOrderIds)
      && state.turnOrderIds.length >= 2
      && state.coordinatorSeatId
      && Number(state.coordinatorEpoch ?? 0) > 0,
    );
  }, { timeout: 20_000, message: 'authoritative state와 coordinator lease가 준비되어야 합니다.' }).toBe(true);

  const state = await getRoomStateForQa(roomId);
  if (!state) throw new Error('authoritative game state가 없습니다.');
  const actorId = String(state.coordinatorSeatId ?? state.turnOrderIds?.[0] ?? '');
  const coordinatorEpoch = Number(state.coordinatorEpoch ?? 0);
  const actorTurnIndex = state.turnOrderIds.findIndex((seatId) => seatId === actorId);
  if (actorTurnIndex < 0) throw new Error('coordinator 좌석이 authoritative turn order에 없습니다.');
  const actorPieces = (state.pieces ?? []).filter((piece) => piece?.ownerId === actorId);
  const opponentPieces = (state.pieces ?? []).filter((piece) => piece?.ownerId !== actorId);
  const actorPieceIds = actorPieces.map((piece) => piece.id);
  expect(actorPieces.length).toBeGreaterThan(0);
  expect(actorPieces.every((piece) => !piece.started && !piece.finished && piece.nodeId === 'n01')).toBe(true);
  expect(opponentPieces.some((piece) => piece?.started && !piece?.finished)).toBe(false);

  const accessToken = await page.evaluate(readFirebaseAccessTokenFromIndexedDb);
  if (!accessToken) throw new Error('timeout fixture 재구성을 위한 호스트 Firebase access token을 찾지 못했습니다.');
  await page.goto('about:blank');

  const settledFixture = await commitRoomStatePatchForQa(page, roomId, {
    stackedRollMode: false,
    turnIndex: actorTurnIndex,
    pieces: state.pieces,
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
    turnDeadlineKind: null,
    turnDeadlineAt: 0,
    turnActionTimeoutCountBySeatId: { [actorId]: INITIAL_TIMEOUT_COUNT },
    autoPlayBySeatId: { [actorId]: false },
  }, actorId, { accessToken });

  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    const currentActorPieces = (current?.pieces ?? []).filter((piece) => piece?.ownerId === actorId);
    return Boolean(
      current
      && Number(current.turnVersion) === settledFixture.turnVersion
      && Number(current.lastSequence) === settledFixture.lastSequence
      && Number(current.turnIndex) === actorTurnIndex
      && current.roll == null
      && current.turnDeadlineKind == null
      && Number(current.turnDeadlineAt ?? 0) === 0
      && currentActorPieces.length === actorPieces.length
      && currentActorPieces.every((piece) => !piece.started && !piece.finished && piece.nodeId === 'n01'),
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '분리된 앱 lifecycle에서 authoritative 말을 모두 대기석 상태로 정규화해야 합니다.',
  }).toBe(true);

  await expectAppShell(page);
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

  await expect.poll(() => page.evaluate(({ expectedActorId, expectedPieceIds, minimumSequence }) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const debugPieces = Array.isArray(debug.pieces) ? debug.pieces : [];
    const actorDebugPieces = debugPieces.filter((piece) => piece?.ownerId === expectedActorId);
    const allDebugPiecesAtBench = actorDebugPieces.length === expectedPieceIds.length
      && actorDebugPieces.every((piece) => (
        expectedPieceIds.includes(piece?.id)
        && piece?.nodeId === 'n01'
        && piece?.started !== true
        && piece?.finished !== true
      ));
    const allDomPiecesAtBench = expectedPieceIds.every((pieceId) => {
      const element = document.querySelector(`[data-testid="piece-${pieceId}"]`);
      return element instanceof HTMLElement && element.classList.contains('off-board');
    });
    return Boolean(
      Number(debug.lastAppliedSequence ?? 0) >= minimumSequence
      && debug.roll == null
      && String(debug.turnDeadlineKind ?? '') === ''
      && Number(debug.turnDeadlineAt ?? 0) === 0
      && (typeof debug.movingPieceId !== 'string' || debug.movingPieceId === '')
      && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0
      && allDebugPiecesAtBench
      && allDomPiecesAtBench
      && document.querySelectorAll('.capture-ghost').length === 0
    );
  }, {
    expectedActorId: actorId,
    expectedPieceIds: actorPieceIds,
    minimumSequence: settledFixture.lastSequence,
  }), {
    timeout: 12_000,
    intervals: [50, 100, 200, 400],
    message: '새 앱 lifecycle이 canonical 대기석 snapshot만 적용한 뒤 timeout fixture를 시작해야 합니다.',
  }).toBe(true);

  const timeoutDeadlineAt = Date.now() + VISIBLE_FIXTURE_DEADLINE_OFFSET_MS;
  const visibleFixture = await commitRoomStatePatchForQa(page, roomId, {
    stackedRollMode: false,
    turnIndex: actorTurnIndex,
    pieces: state.pieces,
    roll: { name: '개', steps: 2 },
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
    turnDeadlineKind: 'move',
    turnDeadlineAt: timeoutDeadlineAt,
    turnActionTimeoutCountBySeatId: { [actorId]: INITIAL_TIMEOUT_COUNT },
    autoPlayBySeatId: { [actorId]: false },
  }, actorId);

  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    const currentActorPieces = (current?.pieces ?? []).filter((piece) => piece?.ownerId === actorId);
    return Boolean(
      current
      && Number(current.turnVersion) === visibleFixture.turnVersion
      && Number(current.lastSequence) === visibleFixture.lastSequence
      && Number(current.turnIndex) === actorTurnIndex
      && current.roll?.name === '개'
      && Number(current.roll?.steps) === 2
      && current.stackedRollMode === false
      && current.turnDeadlineKind === 'move'
      && Number(current.turnDeadlineAt) === timeoutDeadlineAt
      && currentActorPieces.length === actorPieces.length
      && currentActorPieces.every((piece) => !piece.started && !piece.finished && piece.nodeId === 'n01'),
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '일반 개 이동 fixture가 authoritative sequence로 안정적으로 반영되어야 합니다.',
  }).toBe(true);

  const moveButton = page.getByTestId('move-piece-button');
  await expect(moveButton).toBeVisible({ timeout: 10_000 });
  await expect(moveButton).toBeEnabled();

  let targetPieceId = '';
  await expect.poll(async () => {
    const screen = await collectScreenState(page);
    const debugPieces = Array.isArray(screen.yutDebug?.pieces) ? screen.yutDebug.pieces : [];
    const debugActorPieces = debugPieces.filter((piece) => piece?.ownerId === actorId);
    const allDebugPiecesAtBench = debugActorPieces.length === actorPieces.length
      && debugActorPieces.every((piece) => !piece.started && !piece.finished && piece.nodeId === 'n01');
    targetPieceId = String(
      screen.yutDebug?.activeMovablePiece?.id
      ?? screen.yutDebug?.fallbackMovablePiece?.id
      ?? screen.yutDebug?.selectedPieceId
      ?? '',
    );
    const targetElement = targetPieceId
      ? page.getByTestId(`piece-${targetPieceId}`)
      : null;
    const targetAtBench = targetElement
      ? await targetElement.evaluate((element) => element.classList.contains('off-board')).catch(() => false)
      : false;
    return Boolean(
      Number(screen.yutDebug?.lastAppliedSequence ?? 0) >= visibleFixture.lastSequence
      && screen.yutDebug?.roll?.name === '개'
      && Number(screen.yutDebug?.roll?.steps) === 2
      && screen.yutDebug?.turnDeadlineKind === 'move'
      && Number(screen.yutDebug?.turnDeadlineAt) === timeoutDeadlineAt
      && !screen.yutDebug?.movingPieceId
      && Number(screen.yutDebug?.pendingLocalRemoteActionCount ?? 0) === 0
      && allDebugPiecesAtBench
      && targetPieceId
      && targetAtBench
    ) ? targetPieceId : '';
  }, {
    timeout: 5_000,
    intervals: [50, 100, 200],
    message: 'canonical 대기석 DOM에서 timeout UI 자동 이동 대상 말을 확인해야 합니다.',
  }).not.toBe('');
  expect(actorPieces.some((piece) => piece.id === targetPieceId)).toBe(true);
  await startMovePresentationTrace(page, targetPieceId);

  const actionKey = makeTimeoutActionKey({
    roomId,
    stage: 'move',
    actorId,
    timeoutDeadlineAt,
  });
  const sequencesBeforeDeadline = await getRoomSequencesForQa(roomId);
  expect(getMoveSequencesAfter(sequencesBeforeDeadline, visibleFixture.lastSequence, actorId)).toHaveLength(0);

  return {
    actionKey,
    actorId,
    baselineSequence: visibleFixture.lastSequence,
    coordinatorEpoch,
    coordinatorSeatId: String(state.coordinatorSeatId),
    page,
    roomId,
    targetPieceId,
    timeoutDeadlineAt,
  };
}

export async function waitForMoveTimeoutRecovery({
  actionKey,
  actorId,
  baselineSequence,
  coordinatorEpoch,
  coordinatorSeatId,
  page,
  roomId,
  targetPieceId,
  timeoutDeadlineAt,
}) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const matching = getMoveSequencesAfter(sequences, baselineSequence, actorId);
    const state = await getRoomStateForQa(roomId);
    const movedPiece = getPieceById(state?.pieces, targetPieceId);
    if (matching.length !== 1 || !state || !movedPiece) return null;
    if (movedPiece.nodeId !== 'n03' || movedPiece.started !== true || movedPiece.finished === true) return null;
    return { matching, state };
  }, {
    timeout: 20_000,
    intervals: [100, 200, 400, 800],
    message: 'deadline UI와 coordinator가 경합해도 일반 개 이동 sequence와 최종 상태는 정확히 한 번 반영되어야 합니다.',
  }).not.toBeNull();

  let nextAiSequence;
  await expect.poll(async () => {
    const nextSequences = await getRoomSequencesForQa(roomId);
    const matching = getMoveSequencesAfter(nextSequences, baselineSequence, actorId);
    if (matching.length !== 1) return null;
    nextAiSequence = nextSequences.find((sequence) => (
      Number(sequence.sequence ?? 0) > Number(matching[0].sequence ?? 0)
      && sequence.type === 'roll_yut'
      && sequence.actorId !== actorId
    ));
    return nextAiSequence ? {
      actorId: nextAiSequence.actorId,
      coordinatorSeatId: nextAiSequence.action?.payload?.coordinatorSeatId,
      coordinatorEpoch: Number(nextAiSequence.action?.payload?.coordinatorEpoch ?? 0),
    } : null;
  }, {
    timeout: 15_000,
    intervals: [100, 200, 400, 800],
    message: '두 번째 연속 timeout으로 자동 플레이가 켜져도 연결된 human coordinator가 다음 AI 턴을 진행해야 합니다.',
  }).toEqual({
    actorId: expect.not.stringMatching(new RegExp(`^${actorId}$`)),
    coordinatorSeatId,
    coordinatorEpoch,
  });

  const duplicateCheckAt = Date.now() + 1_600;
  await expect.poll(async () => {
    if (Date.now() < duplicateCheckAt) return null;
    const nextSequences = await getRoomSequencesForQa(roomId);
    return getMoveSequencesAfter(nextSequences, baselineSequence, actorId).length;
  }, {
    timeout: 3_000,
    intervals: [100, 200, 400],
    message: '추가 대기 후에도 같은 일반 이동 timeout이 별도 identity로 중복 생성되면 안 됩니다.',
  }).toBe(1);

  const sequences = await getRoomSequencesForQa(roomId);
  const matching = getMoveSequencesAfter(sequences, baselineSequence, actorId);
  const state = await getRoomStateForQa(roomId);
  const sequence = matching[0];
  const sequenceState = sequence?.patch;
  const sequencePiece = getPieceById(sequenceState?.pieces, targetPieceId);
  const serverPiece = getPieceById(state?.pieces, targetPieceId);
  const presentation = await stopMovePresentationTrace(page);
  const screen = await collectScreenState(page);
  const domPiece = getPieceById(screen.yutDebug?.pieces, targetPieceId);
  const moveActionIds = matching.map((entry) => ({
    sequence: entry.sequence,
    clientMutationId: entry.clientMutationId,
    actionClientId: entry.action?.payload?.clientActionId,
  }));

  expect(matching).toHaveLength(1);
  expect(sequence.action?.actorId).toBe(actorId);
  expect(sequence.clientMutationId).toBe(actionKey);
  expect(sequence.action?.payload?.clientActionId).toBe(actionKey);
  expect(sequence.action?.payload?.rollStackIndex ?? null).toBeNull();
  expect(sequencePiece).toMatchObject({ id: targetPieceId, nodeId: 'n03', started: true, finished: false });
  expect(serverPiece).toMatchObject({ id: targetPieceId, nodeId: 'n03', started: true, finished: false });
  expect(sequenceState?.roll).toBeNull();
  expect(sequenceState?.turnActionTimeoutCountBySeatId?.[actorId]).toBe(EXPECTED_TIMEOUT_COUNT);
  expect(sequenceState?.autoPlayBySeatId?.[actorId]).toBe(true);
  expect(Number(sequenceState?.turnDeadlineAt ?? 0)).not.toBe(timeoutDeadlineAt);
  expect(sequence.payload?.capturedPieceIds ?? sequence.action?.payload?.capturedPieceIds ?? []).toEqual([]);
  expect(sequenceState?.captureEffect ?? null).toBeNull();

  expect(presentation.trace?.movingStarts, JSON.stringify(presentation.trace?.samples ?? [])).toBe(1);
  expect(presentation.trace?.benchReturns, JSON.stringify(presentation.trace?.samples ?? [])).toBe(0);
  expect(presentation.trace?.nodePath?.filter((nodeId) => nodeId === 'n02')).toHaveLength(1);
  expect(presentation.trace?.nodePath?.filter((nodeId) => nodeId === 'n03')).toHaveLength(1);
  expect(presentation.trace?.nodePath?.indexOf('n02')).toBeLessThan(presentation.trace?.nodePath?.indexOf('n03'));
  expect(presentation.trace?.appliedSequencePath?.filter((appliedSequence) => appliedSequence === Number(sequence.sequence)).length ?? 0).toBeLessThanOrEqual(1);
  expect(presentation.trace?.captureGhostMax).toBe(0);
  expect(presentation.finalDom).toMatchObject({ offBoard: false, nearestNodeId: 'n03', captureGhostCount: 0 });
  expect(presentation.finalDom?.nearestNodeDistance).toBeLessThan(30);
  expect(domPiece).toMatchObject({ id: targetPieceId, nodeId: serverPiece?.nodeId, started: true, finished: false });

  return {
    moveActionIds,
    nextAiSequence,
    presentation,
    sequence,
    state,
  };
}
