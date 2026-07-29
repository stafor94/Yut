import { expect } from '@playwright/test';
import { makeQaName, normalizeQaNickname } from './env.js';
import { createRoomFromLobby, collectScreenState, primeLobbyStorage, primeTurnOrderResultQueues } from './ui.js';
import { findRoomIdByTitle, getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage } from './rooms.js';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';

const ACTION_WAIT_TIMEOUT_MS = 35_000;
const DO = Object.freeze({ name: '도', steps: 1 });
const GAE = Object.freeze({ name: '개', steps: 2 });

const getHardAiMoveSequences = (sequences, fixtureSequence, aiSeatId) => sequences
  .filter((sequence) => Number(sequence.sequence ?? 0) > fixtureSequence
    && sequence.type === 'move_piece_resolved'
    && sequence.actorId === aiSeatId
    && sequence.action?.type === 'move_piece'
    && String(sequence.action?.payload?.clientActionId ?? '').startsWith('move_piece_ai:'))
  .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));

const findPieceNodeInPatch = (sequence, pieceId) => Array.isArray(sequence?.patch?.pieces)
  ? sequence.patch.pieces.find((piece) => piece?.id === pieceId)?.nodeId
  : undefined;

export async function prepareHardAiAuthoritativeFixture({ page, context, testInfo }) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'hard-ai-host'));
  const roomTitle = makeQaName(testInfo, 'hard-ai-authoritative-room');
  await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '2' });
  await context.addInitScript(() => window.localStorage.setItem('yut-online:stackedRollMode', 'true'));
  await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });
  await createRoomFromLobby(page, roomTitle);
  await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
  const roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
  if (!roomId) throw new Error('hard AI authoritative QA 방 ID를 찾지 못했습니다.');

  const addAiButton = page.getByTestId('add-ai-P2');
  if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const screen = await collectScreenState(page);
    return Boolean(!screen.yutDebug?.turnOrderPhase?.active
      && !screen.yutDebug?.turnOrderIntro
      && Array.isArray(screen.yutDebug?.turnOrderIds)
      && screen.yutDebug.turnOrderIds.length >= 2);
  }, { timeout: 40_000, message: '순서 정하기 완료 후 hard AI fixture를 주입해야 합니다.' }).toBe(true);

  await expect.poll(async () => {
    const current = await getRoomStateForQa(roomId);
    if (!current || !Array.isArray(current.turnOrderIds) || !Array.isArray(current.pieces)) return false;
    if (!current.coordinatorSeatId || Number(current.coordinatorEpoch ?? 0) <= 0) return false;
    return Boolean((current.gameSeats ?? []).find((seat) => seat?.isAI === true || seat?.isSubstitutedByAI === true)?.id);
  }, { timeout: 20_000, message: 'authoritative hard AI seat와 coordinator lease가 준비되어야 합니다.' }).toBe(true);

  const readyState = await getRoomStateForQa(roomId);
  if (!readyState) throw new Error('authoritative game state가 없습니다.');
  const aiSeatId = String((readyState.gameSeats ?? []).find((seat) => seat?.isAI === true || seat?.isSubstitutedByAI === true)?.id ?? '');
  if (!aiSeatId) throw new Error('hard AI seat ID를 찾지 못했습니다.');
  const aiTurnIndex = readyState.turnOrderIds.findIndex((seatId) => seatId === aiSeatId);
  if (aiTurnIndex < 0) throw new Error('turnOrderIds에 hard AI seat가 없습니다.');

  let strategicPieceId = '';
  const patchedPieces = readyState.pieces.map((piece) => {
    if (piece.ownerId !== aiSeatId) return { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: null };
    if (!strategicPieceId) {
      strategicPieceId = String(piece.id);
      return { ...piece, nodeIndex: 3, nodeId: 'n04', started: true, finished: false, previousNodeId: 'n03' };
    }
    return { ...piece, nodeIndex: 0, nodeId: 'n01', started: false, finished: false, previousNodeId: null };
  });
  if (!strategicPieceId) throw new Error('hard AI 전략 말 ID를 찾지 못했습니다.');

  const fixture = await commitAuthoritativeStatePatchForQa(page, roomId, {
    pieces: patchedPieces,
    turnIndex: aiTurnIndex,
    roll: null,
    rollStack: [DO, GAE],
    selectedRollStackIndex: null,
    rollStackClosed: true,
    boardItems: [],
    trapNodes: [],
    shieldedPieceIds: [],
    winner: '',
    pendingGoldenYutSelection: null,
    pendingTrapPlacement: null,
    pendingItemPickup: null,
    itemPromptTiming: null,
    pendingAfterMoveTurnIndex: null,
    branchChoice: 'outer',
    rollResultReadyAt: 0,
    turnDeadlineKind: 'move',
    turnDeadlineAt: Date.now() + 30_000,
    turnActionTimeoutCountBySeatId: { ...(readyState.turnActionTimeoutCountBySeatId ?? {}), [aiSeatId]: 0 },
    autoPlayBySeatId: { ...(readyState.autoPlayBySeatId ?? {}), [aiSeatId]: false },
  }, aiSeatId, { fixtureName: 'hard-ai-authoritative-strategy', errorLabel: 'hard AI authoritative fixture' });

  return { aiSeatId, fixtureSequence: fixture.lastSequence, roomId, strategicPieceId };
}

export async function waitForHardAiAuthoritativeStrategy({ aiSeatId, fixtureSequence, roomId, strategicPieceId }) {
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    const moves = getHardAiMoveSequences(sequences, fixtureSequence, aiSeatId);
    const state = await getRoomStateForQa(roomId);
    return moves.length >= 2 && state?.pieces?.find((piece) => piece?.id === strategicPieceId)?.nodeId === 'd05';
  }, { timeout: ACTION_WAIT_TIMEOUT_MS, intervals: [100, 200, 400, 800], message: 'hard AI가 개→n06, 도→shortcut 순서의 authoritative action을 완료해야 합니다.' }).toBe(true);

  const moves = getHardAiMoveSequences(await getRoomSequencesForQa(roomId), fixtureSequence, aiSeatId);
  const state = await getRoomStateForQa(roomId);
  expect(moves).toHaveLength(2);
  const [firstMove, secondMove] = moves;
  expect(firstMove.action?.payload).toMatchObject({ pieceId: strategicPieceId, rollStackIndex: 1, branchChoice: 'outer' });
  expect(findPieceNodeInPatch(firstMove, strategicPieceId)).toBe('n06');
  expect(secondMove.action?.payload).toMatchObject({ pieceId: strategicPieceId, rollStackIndex: 0, branchChoice: 'shortcut' });
  expect(findPieceNodeInPatch(secondMove, strategicPieceId)).toBe('d05');
  expect(state?.pieces?.find((piece) => piece?.id === strategicPieceId)?.nodeId).toBe('d05');
  expect(Array.isArray(state?.rollStack) ? state.rollStack : []).toHaveLength(0);
  expect(state?.pendingTrapPlacement ?? null).toBeNull();
  expect(state?.pendingItemPickup ?? null).toBeNull();
  return { firstMove, secondMove, state };
}
