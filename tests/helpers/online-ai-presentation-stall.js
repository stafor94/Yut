import { expect } from '@playwright/test';
import { makeQaName, normalizeQaNickname } from './env.js';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import {
  findRoomIdByTitle,
  getRoomSequencesForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from './rooms.js';
import {
  collectScreenState,
  createRoomFromLobby,
  primeLobbyStorage,
  primeTurnOrderResultQueues,
} from './ui.js';

const GAE = Object.freeze({ name: '개', steps: 2 });
const FIXTURE_DEADLINE_OFFSET_MS = 1500;

const normalizePieces = (pieces) => (Array.isArray(pieces) ? pieces : [])
  .map((piece) => ({ id: String(piece?.id ?? ''), nodeId: String(piece?.nodeId ?? '') }))
  .sort((left, right) => left.id.localeCompare(right.id));

const getRecoverySequences = (sequences, actionKey) => sequences.filter((sequence) => (
  sequence.type === 'move_piece_resolved'
  && sequence.action?.type === 'move_piece'
  && sequence.action?.payload?.clientActionId === actionKey
));

const getNormalAiMoveSequences = (sequences, fixtureSequence, aiSeatId) => sequences.filter((sequence) => (
  Number(sequence.sequence ?? 0) > fixtureSequence
  && sequence.type === 'move_piece_resolved'
  && sequence.actorId === aiSeatId
  && String(sequence.action?.payload?.clientActionId ?? '').startsWith('move_piece_ai:')
));

const getSequenceNumber = (sequence) => Number(sequence?.sequence ?? 0);
const getActionKey = (sequence) => String(sequence?.action?.payload?.clientActionId ?? sequence?.clientMutationId ?? '');

export async function prepareOnlineAiPresentationStallFixture({ page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'presentation-host'));
  const roomTitle = makeQaName(testInfo, 'online-ai-presentation-stall');
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: '3',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '2',
  });
  await context.addInitScript(() => window.localStorage.setItem('yut-online:stackedRollMode', 'false'));
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도', '개'] });
  await createRoomFromLobby(page, roomTitle);
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('온라인 AI presentation stall QA 방 ID를 찾지 못했습니다.');

  for (const seatLabel of ['P2', 'P3']) {
    const addAiButton = page.getByTestId(`add-ai-${seatLabel}`);
    if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
  }
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const screen = await collectScreenState(page);
    return Boolean(
      !screen.yutDebug?.turnOrderPhase?.active
      && !screen.yutDebug?.turnOrderIntro
      && Array.isArray(screen.yutDebug?.turnOrderIds)
      && screen.yutDebug.turnOrderIds.length === 3,
    );
  }, { timeout: 40_000, message: '순서 정하기 완료 후 AI presentation fixture를 주입해야 합니다.' }).toBe(true);

  await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    const aiSeats = (state?.gameSeats ?? []).filter((seat) => seat?.isAI === true || seat?.isSubstitutedByAI === true);
    return Boolean(state?.coordinatorSeatId && Number(state?.coordinatorEpoch ?? 0) > 0 && aiSeats.length === 2);
  }, { timeout: 20_000, message: 'human coordinator와 AI 좌석 2개가 준비되어야 합니다.' }).toBe(true);

  const readyState = await getRoomStateForQa(roomId);
  if (!readyState) throw new Error('authoritative game state가 없습니다.');
  const aiSeatIds = (readyState.gameSeats ?? [])
    .filter((seat) => seat?.isAI === true || seat?.isSubstitutedByAI === true)
    .sort((left, right) => Number(left?.seatIndex ?? 0) - Number(right?.seatIndex ?? 0))
    .map((seat) => String(seat.id));
  const humanSeatId = String((readyState.gameSeats ?? []).find((seat) => !aiSeatIds.includes(String(seat?.id ?? '')))?.id ?? '');
  if (aiSeatIds.length !== 2 || !humanSeatId) throw new Error('AI 2명과 human 좌석을 찾지 못했습니다.');
  const [firstAiSeatId, secondAiSeatId] = aiSeatIds;
  const turnOrderIds = [firstAiSeatId, secondAiSeatId, humanSeatId];
  await page.evaluate(() => {
    Math.random = () => 0.3;
  });
  const deadlineAt = Date.now() + FIXTURE_DEADLINE_OFFSET_MS;
  const patchedPieces = (readyState.pieces ?? []).map((piece) => ({
    ...piece,
    nodeIndex: 0,
    nodeId: 'n01',
    previousNodeId: null,
    started: false,
    finished: false,
  }));
  const fixture = await commitAuthoritativeStatePatchForQa(page, roomId, {
    pieces: patchedPieces,
    turnOrderIds,
    initialTurnOrderIds: turnOrderIds,
    turnIndex: 0,
    roll: GAE,
    rollStack: [],
    selectedRollStackIndex: null,
    rollStackClosed: false,
    boardItems: [],
    ownedItems: {},
    trapNodes: [],
    shieldedPieceIds: [],
    lastMovedPieceIds: [],
    lastMovedSeatId: '',
    pendingGoldenYutSelection: null,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: null,
    branchChoice: 'outer',
    rollResultReadyAt: 0,
    rollLockUntil: 0,
    turnDeadlineKind: 'move',
    turnDeadlineAt: deadlineAt,
    turnActionTimeoutCountBySeatId: {
      ...(readyState.turnActionTimeoutCountBySeatId ?? {}),
      [firstAiSeatId]: 0,
      [secondAiSeatId]: 0,
    },
    autoPlayBySeatId: {
      ...(readyState.autoPlayBySeatId ?? {}),
      [firstAiSeatId]: false,
      [secondAiSeatId]: false,
    },
  }, firstAiSeatId, { fixtureName: 'online-ai-presentation-stall', errorLabel: 'online AI presentation stall fixture' });

  await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    const screen = await collectScreenState(page);
    return Boolean(
      state
      && Number(state.lastSequence ?? 0) === fixture.lastSequence
      && Number(state.turnIndex ?? -1) === 0
      && state.roll?.name === GAE.name
      && screen.yutDebug?.roll?.name === GAE.name
      && Number(screen.yutDebug?.turnIndex ?? -1) === 0,
    );
  }, { timeout: 8_000, intervals: [50, 100, 200, 400], message: 'AI 개 이동 snapshot이 서버와 화면에 함께 반영되어야 합니다.' }).toBe(true);

  const actionKey = `timeout:${roomId}:move:${firstAiSeatId}:${deadlineAt}`;
  return {
    actionKey,
    coordinatorEpoch: Number(readyState.coordinatorEpoch ?? 0),
    coordinatorSeatId: String(readyState.coordinatorSeatId ?? ''),
    deadlineAt,
    firstAiSeatId,
    fixtureSequence: fixture.lastSequence,
    roomId,
    secondAiSeatId,
  };
}

export async function waitForOnlineAiPresentationStallRecovery(page, fixture) {
  let winningMoveSequence;
  let nextAiRollSequence;
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(fixture.roomId);
    const recoverySequences = getRecoverySequences(sequences, fixture.actionKey);
    const normalAiMoves = getNormalAiMoveSequences(sequences, fixture.fixtureSequence, fixture.firstAiSeatId);
    const moveWinners = [...recoverySequences, ...normalAiMoves]
      .sort((left, right) => getSequenceNumber(left) - getSequenceNumber(right));
    if (moveWinners.length !== 1) return null;

    winningMoveSequence = moveWinners[0];
    nextAiRollSequence = sequences.find((sequence) => (
      getSequenceNumber(sequence) > getSequenceNumber(winningMoveSequence)
      && sequence.type === 'roll_yut'
      && sequence.actorId === fixture.secondAiSeatId
    ));
    return nextAiRollSequence ? {
      moveResolutionCount: moveWinners.length,
      nextActorId: nextAiRollSequence.actorId,
    } : null;
  }, {
    timeout: 20_000,
    intervals: [100, 200, 400, 800],
    message: '정상 AI 이동과 timeout recovery 중 하나만 확정되고 다음 AI 좌석의 던지기가 예약되어야 합니다.',
  }).toEqual({ moveResolutionCount: 1, nextActorId: fixture.secondAiSeatId });

  const sequences = await getRoomSequencesForQa(fixture.roomId);
  const recoverySequences = getRecoverySequences(sequences, fixture.actionKey);
  const normalAiMoves = getNormalAiMoveSequences(sequences, fixture.fixtureSequence, fixture.firstAiSeatId);
  expect(recoverySequences.length + normalAiMoves.length).toBe(1);

  const recoverySequence = recoverySequences[0];
  if (recoverySequence) {
    expect(recoverySequence.action?.payload).toMatchObject({
      clientActionId: fixture.actionKey,
      coordinatorEpoch: fixture.coordinatorEpoch,
      coordinatorSeatId: fixture.coordinatorSeatId,
      recoveredByCoordinator: true,
      reason: 'stalled-roll-move-timeout',
      timeoutDeadlineAt: fixture.deadlineAt,
    });
  } else {
    expect(getActionKey(normalAiMoves[0])).toMatch(/^move_piece_ai:/);
  }

  await expect.poll(async () => {
    const state = await getRoomStateForQa(fixture.roomId);
    const screen = await collectScreenState(page);
    if (!state || !screen.yutDebug) return null;
    return {
      piecesMatch: JSON.stringify(normalizePieces(screen.yutDebug.pieces)) === JSON.stringify(normalizePieces(state.pieces)),
      rollMatch: String(screen.yutDebug.roll?.name ?? '') === String(state.roll?.name ?? ''),
      rollStackMatch: JSON.stringify(screen.yutDebug.rollStack ?? []) === JSON.stringify(state.rollStack ?? []),
      turnIndexMatch: Number(screen.yutDebug.turnIndex ?? -1) === Number(state.turnIndex ?? -1),
    };
  }, {
    timeout: 10_000,
    intervals: [100, 200, 400],
    message: '원격 이동 애니메이션 중 후속 snapshot이 와도 말 좌표·이동 스택·턴 상태가 최신 서버 상태에 수렴해야 합니다.',
  }).toEqual({ piecesMatch: true, rollMatch: true, rollStackMatch: true, turnIndexMatch: true });

  const duplicateCheckAt = Date.now() + 1_600;
  const nextAiRollActionKey = getActionKey(nextAiRollSequence);
  await expect.poll(async () => {
    if (Date.now() < duplicateCheckAt) return null;
    const latestSequences = await getRoomSequencesForQa(fixture.roomId);
    const latestRecoveryCount = getRecoverySequences(latestSequences, fixture.actionKey).length;
    const latestNormalMoveCount = getNormalAiMoveSequences(latestSequences, fixture.fixtureSequence, fixture.firstAiSeatId).length;
    return {
      moveResolutionCount: latestRecoveryCount + latestNormalMoveCount,
      nextAiRollDuplicateCount: latestSequences.filter((sequence) => (
        sequence.type === 'roll_yut'
        && sequence.actorId === fixture.secondAiSeatId
        && getActionKey(sequence) === nextAiRollActionKey
      )).length,
    };
  }, { timeout: 3_000, intervals: [100, 200, 400], message: '경합 이후 이동 확정과 다음 AI 던지기 action key가 중복 생성되면 안 됩니다.' })
    .toEqual({ moveResolutionCount: 1, nextAiRollDuplicateCount: 1 });

  return { nextAiRollSequence, recoverySequence: recoverySequence ?? null, winningMoveSequence };
}
