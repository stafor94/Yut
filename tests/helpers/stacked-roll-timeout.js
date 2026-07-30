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

const commitRoomStatePatchForQa = (page, roomId, patch, actorId) => commitAuthoritativeStatePatchForQa(
  page,
  roomId,
  patch,
  actorId,
  { fixtureName: 'stacked-roll-timeout', errorLabel: 'stacked timeout fixture' },
);

const getRecoverySequences = (sequences, actionKey) => sequences.filter((sequence) => (
  sequence.type === 'move_piece_resolved'
  && sequence.action?.type === 'move_piece'
  && sequence.action?.payload?.clientActionId === actionKey
));

export async function prepareStackedRollTimeoutFixture({ page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'stackhost'));
  const roomTitle = makeQaName(testInfo, 'stack-timeout-room');
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await context.addInitScript(() => {
    window.localStorage.setItem('yut-online:stackedRollMode', 'true');
  });
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await createRoomFromLobby(page, roomTitle);
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('stacked timeout QA 방 ID를 찾지 못했습니다.');

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
  }, { timeout: 40_000, message: '순서 정하기 완료 후 stacked timeout fixture를 주입해야 합니다.' }).toBe(true);

  const readyState = await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    if (!state || !Array.isArray(state.turnOrderIds) || !state.turnOrderIds.length) return null;
    if (!state.coordinatorSeatId || Number(state.coordinatorEpoch ?? 0) <= 0) return null;
    return state;
  }, { timeout: 20_000, message: 'authoritative state와 coordinator lease가 준비되어야 합니다.' }).not.toBeNull();
  void readyState;
  const state = await getRoomStateForQa(roomId);
  if (!state) throw new Error('authoritative game state가 없습니다.');
  const actorId = String(state.coordinatorSeatId ?? state.turnOrderIds?.[0] ?? '');
  const actorTurnIndex = Math.max(0, state.turnOrderIds.findIndex((seatId) => seatId === actorId));
  const actorPiecesOnBoard = Array.isArray(state.pieces)
    ? state.pieces.filter((piece) => piece?.ownerId === actorId && piece?.started && !piece?.finished)
    : [];
  expect(actorPiecesOnBoard).toHaveLength(0);
  const visibleDeadlineAt = Date.now() + VISIBLE_FIXTURE_DEADLINE_OFFSET_MS;
  const visibleFixture = await commitRoomStatePatchForQa(page, roomId, {
    turnIndex: actorTurnIndex,
    roll: null,
    rollStack: [
      { name: '빽도', steps: -1 },
      { name: '도', steps: 1 },
    ],
    selectedRollStackIndex: null,
    rollStackClosed: true,
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
    const currentStack = Array.isArray(current?.rollStack) ? current.rollStack : [];
    return Boolean(
      current
      && Number(current.turnVersion) === visibleFixture.turnVersion
      && Number(current.lastSequence) === visibleFixture.lastSequence
      && Number(current.turnIndex) === actorTurnIndex
      && current.roll === null
      && current.selectedRollStackIndex === null
      && current.rollStackClosed === true
      && current.turnDeadlineKind === 'move'
      && Number(current.turnDeadlineAt) === visibleDeadlineAt
      && currentStack.length === 2
      && currentStack[0]?.name === '빽도'
      && Number(currentStack[0]?.steps) === -1
      && currentStack[1]?.name === '도'
      && Number(currentStack[1]?.steps) === 1,
    );
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: '빽도와 일반 결과가 섞인 닫힌 이동 스택 fixture가 authoritative sequence로 안정적으로 반영되어야 합니다.',
  }).toBe(true);

  const picker = page.locator('.roll-stack-picker');
  await expect(picker).toBeVisible({ timeout: 10_000 });
  const buttons = picker.getByRole('button');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.first()).toBeDisabled();
  await expect(buttons.nth(1)).toBeEnabled();
  await buttons.first().evaluate((button) => button.click());
  await expect.poll(async () => (await getRoomStateForQa(roomId))?.selectedRollStackIndex ?? null, {
    timeout: 1_000,
    intervals: [25, 50, 100],
    message: '네이티브 disabled 빽도 버튼의 프로그램 방식 click도 선택 상태를 변경하면 안 됩니다.',
  }).toBeNull();

  const timeoutDeadlineAt = Date.now() - 1;
  const actionKey = `timeout:${roomId}:move:${actorId}:${timeoutDeadlineAt}`;
  const baselineSequences = await getRoomSequencesForQa(roomId);
  const expiredFixture = await commitRoomStatePatchForQa(page, roomId, {
    turnDeadlineAt: timeoutDeadlineAt,
  }, actorId);
  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    return Boolean(
      current
      && Number(current.turnVersion) === expiredFixture.turnVersion
      && Number(current.lastSequence) === expiredFixture.lastSequence
      && Number(current.turnDeadlineAt) === timeoutDeadlineAt,
    );
  }, {
    timeout: 2_000,
    intervals: [25, 50, 100],
    message: '만료된 move deadline fixture가 authoritative sequence로 반영되어야 합니다.',
  }).toBe(true);
  await expect.poll(async () => {
    const expiredButtons = picker.getByRole('button');
    const buttonCount = await expiredButtons.count();
    if (buttonCount === 0) return true;
    return expiredButtons.evaluateAll((entries) => entries.length === 2 && entries.every((button) => button.disabled));
  }, {
    timeout: 900,
    intervals: [25, 50, 100],
    message: 'deadline 이후 이동 스택 선택 버튼은 다시 활성화되지 않아야 합니다.',
  }).toBe(true);

  return {
    actionKey,
    actorId,
    baselineSequenceCount: baselineSequences.length,
    roomId,
    timeoutDeadlineAt,
  };
}

export async function waitForStackedRollTimeoutRecovery({ actionKey, actorId, roomId, timeoutDeadlineAt }) {
  const recovery = await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const matching = getRecoverySequences(sequences, actionKey);
    const state = await getRoomStateForQa(roomId);
    if (matching.length !== 1 || !state) return null;
    const action = matching[0].action;
    const remainingStack = Array.isArray(state.rollStack) ? state.rollStack : [];
    if (remainingStack.length !== 1) return null;
    return {
      action,
      matchingCount: matching.length,
      remainingStack,
      state,
    };
  }, { timeout: 15_000, intervals: [100, 200, 400, 800], message: 'deadline+network grace 이후 첫 번째 선택 가능한 일반 결과 recovery sequence가 정확히 한 번 생성되어야 합니다.' }).not.toBeNull();
  void recovery;

  const sequences = await getRoomSequencesForQa(roomId);
  const matching = getRecoverySequences(sequences, actionKey);
  const state = await getRoomStateForQa(roomId);
  expect(matching).toHaveLength(1);
  expect(matching[0].action?.payload).toMatchObject({
    recoveredByCoordinator: true,
    rollStackIndex: 1,
    timeoutDeadlineAt,
  });
  expect(state?.rollStack).toEqual([{ name: '빽도', steps: -1 }]);
  expect(state?.turnActionTimeoutCountBySeatId?.[actorId]).toBe(1);
  expect(state?.turnDeadlineAt).not.toBe(timeoutDeadlineAt);

  const duplicateCheckAt = Date.now() + 1_600;
  await expect.poll(async () => {
    if (Date.now() < duplicateCheckAt) return null;
    const nextSequences = await getRoomSequencesForQa(roomId);
    return getRecoverySequences(nextSequences, actionKey).length;
  }, { timeout: 3_000, intervals: [100, 200, 400], message: '추가 대기 후에도 같은 timeout recovery가 중복 생성되면 안 됩니다.' }).toBe(1);

  return { sequence: matching[0], state };
}
