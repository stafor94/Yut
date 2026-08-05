import { expect } from '@playwright/test';
import { getLowestLabelPiece } from '../../src/app/flows/pieceSelection.ts';
import { getTurnActionTimeoutMsForCount } from '../../src/features/room/services/roomTiming.ts';
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
const PRE_DEADLINE_ASSERTION_OFFSET_MS = 2_500;
const INITIAL_TIMEOUT_COUNT = 1;
const EXPECTED_TIMEOUT_COUNT = INITIAL_TIMEOUT_COUNT + 1;
const TARGET_START_NODE_ID = 'n02';
const TARGET_START_NODE_INDEX = 1;
const ALTERNATE_START_NODE_ID = 'n08';
const ALTERNATE_START_NODE_INDEX = 7;
const EXPECTED_TARGET_NODE_ID = 'n04';

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
  expect(actorPieces.length).toBeGreaterThanOrEqual(2);
  expect(actorPieces.every((piece) => !piece.started && !piece.finished && piece.nodeId === 'n01')).toBe(true);
  expect(opponentPieces.some((piece) => piece?.started && !piece?.finished)).toBe(false);

  const targetPiece = getLowestLabelPiece(actorPieces);
  const alternatePiece = getLowestLabelPiece(actorPieces.filter((piece) => piece.id !== targetPiece?.id));
  if (!targetPiece || !alternatePiece) throw new Error('timeout 선택 fixture에 서로 다른 두 개의 내 말이 필요합니다.');
  const targetPieceId = targetPiece.id;
  const alternatePieceId = alternatePiece.id;
  const timeoutSelectionPieces = (state.pieces ?? []).map((piece) => {
    if (piece?.ownerId !== actorId) return piece;
    if (piece.id === targetPieceId) {
      return {
        ...piece,
        nodeIndex: TARGET_START_NODE_INDEX,
        nodeId: TARGET_START_NODE_ID,
        started: true,
        finished: false,
        previousNodeId: undefined,
      };
    }
    if (piece.id === alternatePieceId) {
      return {
        ...piece,
        nodeIndex: ALTERNATE_START_NODE_INDEX,
        nodeId: ALTERNATE_START_NODE_ID,
        started: true,
        finished: false,
        previousNodeId: undefined,
      };
    }
    return {
      ...piece,
      nodeIndex: 0,
      nodeId: 'n01',
      started: false,
      finished: false,
      previousNodeId: undefined,
    };
  });
  const expectedActorPieceStates = actorPieces.map((piece) => ({
    id: piece.id,
    nodeId: piece.id === targetPieceId
      ? TARGET_START_NODE_ID
      : piece.id === alternatePieceId ? ALTERNATE_START_NODE_ID : 'n01',
    started: piece.id === targetPieceId || piece.id === alternatePieceId,
  }));
  const hasExpectedActorPieceLayout = (pieces) => {
    const currentActorPieces = (pieces ?? []).filter((piece) => piece?.ownerId === actorId);
    return currentActorPieces.length === expectedActorPieceStates.length
      && expectedActorPieceStates.every((expectedPiece) => {
        const currentPiece = getPieceById(currentActorPieces, expectedPiece.id);
        return Boolean(
          currentPiece
          && currentPiece.nodeId === expectedPiece.nodeId
          && currentPiece.started === expectedPiece.started
          && currentPiece.finished === false
        );
      });
  };

  const accessToken = await page.evaluate(readFirebaseAccessTokenFromIndexedDb);
  if (!accessToken) throw new Error('timeout fixture 재구성을 위한 호스트 Firebase access token을 찾지 못했습니다.');
  await page.goto('about:blank');

  const settledFixture = await commitRoomStatePatchForQa(page, roomId, {
    stackedRollMode: false,
    turnIndex: actorTurnIndex,
    pieces: timeoutSelectionPieces,
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
    return Boolean(
      current
      && Number(current.turnVersion) === settledFixture.turnVersion
      && Number(current.lastSequence) === settledFixture.lastSequence
      && Number(current.turnIndex) === actorTurnIndex
      && current.roll == null
      && current.turnDeadlineKind == null
      && Number(current.turnDeadlineAt ?? 0) === 0
      && hasExpectedActorPieceLayout(current.pieces),
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '분리된 앱 lifecycle에서 authoritative 말을 유효한 timeout 선택 상태로 정규화해야 합니다.',
  }).toBe(true);

  await expectAppShell(page);
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

  await expect.poll(() => page.evaluate(({ expectedActorId, expectedPieceStates, minimumSequence }) => {
    const debug = window.__YUT_DEBUG_STATE__ ?? {};
    const debugPieces = Array.isArray(debug.pieces) ? debug.pieces : [];
    const actorDebugPieces = debugPieces.filter((piece) => piece?.ownerId === expectedActorId);
    const allDebugPiecesMatch = actorDebugPieces.length === expectedPieceStates.length
      && expectedPieceStates.every((expectedPiece) => {
        const currentPiece = actorDebugPieces.find((piece) => piece?.id === expectedPiece.id);
        return Boolean(
          currentPiece
          && currentPiece.nodeId === expectedPiece.nodeId
          && currentPiece.started === expectedPiece.started
          && currentPiece.finished !== true
        );
      });
    const allDomPiecesMatch = expectedPieceStates.every((expectedPiece) => {
      const element = document.querySelector(`[data-testid="piece-${expectedPiece.id}"]`);
      if (!(element instanceof HTMLElement)) return false;
      const isOffBoard = element.classList.contains('off-board');
      return expectedPiece.started ? !isOffBoard : isOffBoard;
    });
    return Boolean(
      Number(debug.lastAppliedSequence ?? 0) >= minimumSequence
      && debug.roll == null
      && String(debug.turnDeadlineKind ?? '') === ''
      && Number(debug.turnDeadlineAt ?? 0) === 0
      && (typeof debug.movingPieceId !== 'string' || debug.movingPieceId === '')
      && Number(debug.pendingLocalRemoteActionCount ?? 0) === 0
      && allDebugPiecesMatch
      && allDomPiecesMatch
      && document.querySelectorAll('.capture-ghost').length === 0
    );
  }, {
    expectedActorId: actorId,
    expectedPieceStates: expectedActorPieceStates,
    minimumSequence: settledFixture.lastSequence,
  }), {
    timeout: 12_000,
    intervals: [50, 100, 200, 400],
    message: '새 앱 lifecycle이 canonical timeout 선택 snapshot만 적용한 뒤 fixture를 시작해야 합니다.',
  }).toBe(true);

  expect(actorPieces.some((piece) => piece.id === targetPieceId)).toBe(true);
  await expect(page.getByTestId(`piece-${targetPieceId}`)).not.toHaveClass(/off-board/);
  await startMovePresentationTrace(page, targetPieceId);

  const sequencesBeforeTimeoutFixture = await getRoomSequencesForQa(roomId);
  expect(getMoveSequencesAfter(sequencesBeforeTimeoutFixture, settledFixture.lastSequence, actorId)).toHaveLength(0);

  const timeoutDurationMs = getTurnActionTimeoutMsForCount(INITIAL_TIMEOUT_COUNT);
  const timeoutDeadlineAt = Date.now() + VISIBLE_FIXTURE_DEADLINE_OFFSET_MS;
  const rollResultReadyAt = timeoutDeadlineAt - timeoutDurationMs;
  const actionKey = makeTimeoutActionKey({
    roomId,
    stage: 'move',
    actorId,
    timeoutDeadlineAt,
  });
  const visibleFixture = await commitRoomStatePatchForQa(page, roomId, {
    stackedRollMode: false,
    turnIndex: actorTurnIndex,
    pieces: timeoutSelectionPieces,
    roll: { name: '개', steps: 2 },
    rollStack: [],
    selectedRollStackIndex: null,
    rollStackClosed: false,
    rollAnimation: null,
    rollResultReadyAt,
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
    return Boolean(
      current
      && Number(current.turnVersion) === visibleFixture.turnVersion
      && Number(current.lastSequence) === visibleFixture.lastSequence
      && Number(current.turnIndex) === actorTurnIndex
      && current.roll?.name === '개'
      && Number(current.roll?.steps) === 2
      && current.stackedRollMode === false
      && Number(current.rollResultReadyAt ?? 0) === rollResultReadyAt
      && current.turnDeadlineKind === 'move'
      && Number(current.turnDeadlineAt) === timeoutDeadlineAt
      && hasExpectedActorPieceLayout(current.pieces),
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '두 개의 선택 가능한 내 말을 가진 일반 개 이동 fixture가 authoritative sequence로 반영되어야 합니다.',
  }).toBe(true);

  const preDeadlineCheckAt = timeoutDeadlineAt - PRE_DEADLINE_ASSERTION_OFFSET_MS;
  await expect.poll(async () => {
    if (Date.now() < preDeadlineCheckAt) return null;
    const sequences = await getRoomSequencesForQa(roomId);
    const current = await getRoomStateForQa(roomId);
    const serverPiece = getPieceById(current?.pieces, targetPieceId);
    const browserState = await page.evaluate((pieceId) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const debugPiece = Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.id === pieceId)
        : undefined;
      return {
        debugMovingPieceId: typeof debug.movingPieceId === 'string' ? debug.movingPieceId : '',
        debugNodeId: debugPiece?.nodeId ?? '',
        movingStarts: Number(window.__YUT_TIMEOUT_MOVE_TRACE__?.movingStarts ?? -1),
      };
    }, targetPieceId);
    return {
      beforeDeadline: Date.now() < timeoutDeadlineAt,
      moveSequenceCount: getMoveSequencesAfter(sequences, visibleFixture.lastSequence, actorId).length,
      serverNodeId: serverPiece?.nodeId ?? '',
      serverStarted: serverPiece?.started === true,
      ...browserState,
    };
  }, {
    timeout: VISIBLE_FIXTURE_DEADLINE_OFFSET_MS,
    intervals: [100, 200, 400],
    message: '선택 가능한 말이 두 개이면 마감 전 자동 단일 이동이 시작되면 안 됩니다.',
  }).toEqual({
    beforeDeadline: true,
    moveSequenceCount: 0,
    serverNodeId: TARGET_START_NODE_ID,
    serverStarted: true,
    debugMovingPieceId: '',
    debugNodeId: TARGET_START_NODE_ID,
    movingStarts: 0,
  });

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
    if (movedPiece.nodeId !== EXPECTED_TARGET_NODE_ID || movedPiece.started !== true || movedPiece.finished === true) return null;
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
  expect(sequencePiece).toMatchObject({ id: targetPieceId, nodeId: EXPECTED_TARGET_NODE_ID, started: true, finished: false });
  expect(serverPiece).toMatchObject({ id: targetPieceId, nodeId: EXPECTED_TARGET_NODE_ID, started: true, finished: false });
  expect(sequenceState?.roll).toBeNull();
  expect(sequenceState?.turnActionTimeoutCountBySeatId?.[actorId]).toBe(EXPECTED_TIMEOUT_COUNT);
  expect(sequenceState?.autoPlayBySeatId?.[actorId]).toBe(true);
  expect(Number(sequenceState?.turnDeadlineAt ?? 0)).not.toBe(timeoutDeadlineAt);
  expect(sequence.payload?.capturedPieceIds ?? sequence.action?.payload?.capturedPieceIds ?? []).toEqual([]);
  expect(sequenceState?.captureEffect ?? null).toBeNull();

  expect(presentation.trace?.movingStarts, JSON.stringify(presentation.trace?.samples ?? [])).toBe(1);
  expect(presentation.trace?.benchReturns, JSON.stringify(presentation.trace?.samples ?? [])).toBe(0);
  expect(presentation.trace?.nodePath?.filter((nodeId) => nodeId === TARGET_START_NODE_ID)).toHaveLength(1);
  expect(presentation.trace?.nodePath?.filter((nodeId) => nodeId === 'n03')).toHaveLength(1);
  expect(presentation.trace?.nodePath?.filter((nodeId) => nodeId === EXPECTED_TARGET_NODE_ID)).toHaveLength(1);
  expect(presentation.trace?.nodePath?.indexOf(TARGET_START_NODE_ID)).toBeLessThan(presentation.trace?.nodePath?.indexOf('n03'));
  expect(presentation.trace?.nodePath?.indexOf('n03')).toBeLessThan(presentation.trace?.nodePath?.indexOf(EXPECTED_TARGET_NODE_ID));
  expect(presentation.trace?.appliedSequencePath?.filter((appliedSequence) => appliedSequence === Number(sequence.sequence)).length ?? 0).toBeLessThanOrEqual(1);
  expect(presentation.trace?.captureGhostMax).toBe(0);
  expect(presentation.finalDom).toMatchObject({ offBoard: false, nearestNodeId: EXPECTED_TARGET_NODE_ID, captureGhostCount: 0 });
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
