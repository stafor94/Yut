import { expect } from '@playwright/test';
import { makeQaName, normalizeQaNickname } from './env.js';
import {
  createRoomFromLobby,
  collectScreenState,
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
const EXPIRED_FIXTURE_AGE_MS = 100;

const commitRoomStatePatchForQa = (page, roomId, patch, actorId) => commitAuthoritativeStatePatchForQa(
  page,
  roomId,
  patch,
  actorId,
  { fixtureName: 'move-timeout-recovery', errorLabel: 'normal move timeout fixture' },
);

const getRecoverySequences = (sequences, actionKey) => sequences.filter((sequence) => (
  sequence.type === 'move_piece_resolved'
  && sequence.action?.type === 'move_piece'
  && sequence.action?.payload?.clientActionId === actionKey
));

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
  const visibleDeadlineAt = Date.now() + VISIBLE_FIXTURE_DEADLINE_OFFSET_MS;
  const visibleFixture = await commitRoomStatePatchForQa(page, roomId, {
    stackedRollMode: false,
    turnIndex: actorTurnIndex,
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
    branchChoice: 'outer',
    turnDeadlineKind: 'move',
    turnDeadlineAt: visibleDeadlineAt,
    turnActionTimeoutCountBySeatId: { [actorId]: 0 },
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
      && current.turnDeadlineKind === 'move'
      && Number(current.turnDeadlineAt) === visibleDeadlineAt,
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '일반 개 이동 fixture가 authoritative sequence로 안정적으로 반영되어야 합니다.',
  }).toBe(true);

  await expect(page.getByTestId('move-piece-button')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('move-piece-button')).toBeEnabled();

  const timeoutDeadlineAt = Date.now() - EXPIRED_FIXTURE_AGE_MS;
  const actionKey = `timeout:${roomId}:move:${actorId}:${timeoutDeadlineAt}`;
  const expiredFixture = await commitRoomStatePatchForQa(page, roomId, {
    turnDeadlineAt: timeoutDeadlineAt,
  }, actorId);
  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    return Boolean(
      current
      && Number(current.turnVersion) === expiredFixture.turnVersion
      && Number(current.lastSequence) === expiredFixture.lastSequence
      && current.roll?.name === '개'
      && current.turnDeadlineKind === 'move'
      && Number(current.turnDeadlineAt) === timeoutDeadlineAt,
    );
  }, {
    timeout: 2_000,
    intervals: [25, 50, 100],
    message: '만료된 일반 move deadline fixture가 authoritative sequence로 반영되어야 합니다.',
  }).toBe(true);

  await expect(page.getByTestId('move-piece-button')).toBeDisabled({ timeout: 700 });
  const sequencesBeforeGrace = await getRoomSequencesForQa(roomId);
  expect(getRecoverySequences(sequencesBeforeGrace, actionKey)).toHaveLength(0);

  return {
    actionKey,
    actorId,
    coordinatorEpoch,
    coordinatorSeatId: String(state.coordinatorSeatId),
    expiredFixtureSequence: expiredFixture.lastSequence,
    roomId,
    timeoutDeadlineAt,
  };
}

export async function waitForMoveTimeoutRecovery({
  actionKey,
  actorId,
  coordinatorEpoch,
  coordinatorSeatId,
  expiredFixtureSequence,
  roomId,
  timeoutDeadlineAt,
}) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const matching = getRecoverySequences(sequences, actionKey);
    const state = await getRoomStateForQa(roomId);
    if (matching.length !== 1 || !state) return null;
    if (Number(state.lastSequence ?? 0) <= Number(expiredFixtureSequence ?? 0)) return null;
    return { matching, state };
  }, {
    timeout: 15_000,
    intervals: [100, 200, 400, 800],
    message: 'deadline+network grace 이후 일반 이동 recovery sequence가 정확히 한 번 생성되어야 합니다.',
  }).not.toBeNull();

  const sequences = await getRoomSequencesForQa(roomId);
  const matching = getRecoverySequences(sequences, actionKey);
  const state = await getRoomStateForQa(roomId);
  expect(matching).toHaveLength(1);
  expect(matching[0].action?.actorId).toBe(actorId);
  expect(matching[0].action?.payload).toMatchObject({
    clientActionId: actionKey,
    coordinatorEpoch,
    coordinatorSeatId,
    recoveredByCoordinator: true,
    reason: 'stalled-roll-move-timeout',
    timeoutDeadlineAt,
  });
  expect(matching[0].action?.payload?.rollStackIndex ?? null).toBeNull();
  expect(state?.roll).toBeNull();
  expect(state?.turnActionTimeoutCountBySeatId?.[actorId]).toBe(1);
  expect(Number(state?.turnDeadlineAt ?? 0)).not.toBe(timeoutDeadlineAt);

  const duplicateCheckAt = Date.now() + 1_600;
  await expect.poll(async () => {
    if (Date.now() < duplicateCheckAt) return null;
    const nextSequences = await getRoomSequencesForQa(roomId);
    return getRecoverySequences(nextSequences, actionKey).length;
  }, {
    timeout: 3_000,
    intervals: [100, 200, 400],
    message: '추가 대기 후에도 같은 일반 이동 timeout recovery가 중복 생성되면 안 됩니다.',
  }).toBe(1);

  return { sequence: matching[0], state };
}
