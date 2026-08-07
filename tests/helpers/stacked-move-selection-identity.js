import { expect } from '@playwright/test';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import { makeQaName, normalizeQaNickname } from './env.js';
import { getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage } from './rooms.js';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, primeTurnOrderResultQueues } from './ui.js';

const MO = { name: '모', steps: 5, bonus: true };
const BACKDO = { name: '빽도', steps: -1, bonus: false };

export async function prepareStackedMoveIdentityFixture({ page, context, testInfo }) {
  await primeLobbyStorage(context, {
    nickname: normalizeQaNickname(makeQaName(testInfo, 'stack-id-host')),
    maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '1',
  });
  await context.addInitScript(() => window.localStorage.setItem('yut-online:stackedRollMode', 'true'));
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await createRoomFromLobby(page, makeQaName(testInfo, 'stack-id-room'));
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page);
  if (!roomId) throw new Error('stacked move identity QA room id를 찾지 못했습니다.');
  const addAiButton = page.getByTestId('add-ai-P2');
  if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const debug = (await collectScreenState(page)).yutDebug ?? {};
    return Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active && !debug.turnOrderIntro;
  }, { timeout: 40_000 }).toBe(true);

  const state = await expect.poll(() => getRoomStateForQa(roomId), { timeout: 15_000 }).not.toBeNull().then(() => getRoomStateForQa(roomId));
  if (!state) throw new Error('stacked move identity authoritative state가 없습니다.');
  const actorId = String(state.coordinatorSeatId ?? state.turnOrderIds?.[0] ?? '');
  const turnIndex = state.turnOrderIds.findIndex((seatId) => seatId === actorId);
  const pieceId = state.pieces.find((piece) => piece?.ownerId === actorId && !piece?.finished)?.id;
  if (!actorId || turnIndex < 0 || !pieceId) throw new Error('stacked move identity actor/piece를 찾지 못했습니다.');
  const fixture = await commitAuthoritativeStatePatchForQa(page, roomId, {
    turnIndex, roll: null, rollStack: [MO, BACKDO], selectedRollStackIndex: null, rollStackClosed: true,
    rollAnimation: null, rollResultReadyAt: 0, pendingGoldenYutSelection: null, pendingTrapPlacement: null,
    pendingItemPickup: null, itemPromptTiming: null, branchChoice: 'outer', turnDeadlineKind: 'move',
    turnDeadlineAt: Date.now() + 30_000, turnActionTimeoutCountBySeatId: { [actorId]: 0 }, autoPlayBySeatId: { [actorId]: false },
  }, actorId, { fixtureName: 'stacked-move-selection-identity', errorLabel: 'stacked move identity fixture' });
  await expect.poll(async () => {
    const debug = (await collectScreenState(page)).yutDebug ?? {};
    return Number(debug.lastAppliedSequence ?? 0) === fixture.lastSequence
      && Number(debug.turnIndex ?? -1) === turnIndex;
  }, {
    timeout: 10_000,
    intervals: [50, 100, 200, 400],
    message: 'stacked move identity fixture sequence가 브라우저 authoritative state에 적용되어야 합니다.',
  }).toBe(true);
  return { actorId, baselineSequences: await getRoomSequencesForQa(roomId), pieceId, roomId, turnIndex };
}

export async function exerciseStackedMoBackDoMoves(page, fixture) {
  const { actorId, baselineSequences, pieceId, roomId, turnIndex } = fixture;
  const picker = page.locator('.roll-stack-picker');
  await expect(picker).toBeVisible({ timeout: 5_000 });
  const choices = picker.getByRole('button');
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).toHaveText('모');
  await expect(choices.nth(1)).toHaveText('빽도');
  await expect(choices.nth(1)).toBeDisabled();
  if (await choices.first().isDisabled()) {
    const pieceButton = page.getByTestId(`piece-${pieceId}`);
    await expect(pieceButton).toBeEnabled({ timeout: 5_000 });
    await pieceButton.click();
  }
  await expect(choices.first()).toBeEnabled({ timeout: 5_000 });
  await choices.first().click();
  await expect(page.getByTestId('move-piece-button')).toBeEnabled({ timeout: 5_000 });
  await page.getByTestId('move-piece-button').click();

  await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    const piece = state?.pieces?.find((entry) => entry?.id === pieceId);
    return piece?.nodeId === 'n06' && state?.turnIndex === turnIndex
      && state?.rollStack?.length === 1 && state.rollStack[0]?.name === '빽도';
  }, { timeout: 20_000, message: '모 +5 뒤 authoritative stack에는 빽도만 남아야 합니다.' }).toBe(true);
  await expect.poll(async () => {
    const debug = (await collectScreenState(page)).yutDebug ?? {};
    const piece = debug.pieces?.find((entry) => entry?.id === pieceId);
    return piece?.nodeId === 'n06' && piece?.started === true && !debug.movingPieceId
      && debug.turnIndex === turnIndex;
  }, { timeout: 10_000, message: '모 이동 뒤 말이 대기석으로 되감기면 안 됩니다.' }).toBe(true);
  await expect(picker.getByRole('button')).toHaveCount(1, { timeout: 10_000 });
  await expect(picker.getByRole('button').first()).toHaveText('빽도');

  await expect(page.getByTestId('move-piece-button')).toBeEnabled({ timeout: 5_000 });
  await page.getByTestId('move-piece-button').click();
  await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    const piece = state?.pieces?.find((entry) => entry?.id === pieceId);
    return piece?.nodeId === 'n05' && state?.rollStack?.length === 0 && state?.turnIndex !== turnIndex;
  }, { timeout: 20_000, message: '빽도 -1 뒤에만 stack이 비고 상대 턴으로 넘어가야 합니다.' }).toBe(true);

  const moves = (await getRoomSequencesForQa(roomId)).slice(baselineSequences.length)
    .filter((sequence) => sequence.type === 'move_piece_resolved' && sequence.actorId === actorId);
  expect(moves).toHaveLength(2);
  expect(moves.map((move) => move.action?.payload?.stackedMoveSelection?.roll?.name)).toEqual(['모', '빽도']);
  expect(new Set(moves.map((move) => move.clientMutationId)).size).toBe(2);
}
