import { expect } from '@playwright/test';
import { commitAuthoritativeStatePatchForQa } from './authoritative-state-fixture.js';
import { makeQaName, normalizeQaNickname } from './env.js';
import { getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage } from './rooms.js';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, primeTurnOrderResultQueues } from './ui.js';

const MO = { name: '모', steps: 5, bonus: true };
const BACKDO = { name: '빽도', steps: -1, bonus: false };
const VISIBLE_FIXTURE_DEADLINE_OFFSET_MS = 9_000;

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
    turnDeadlineAt: Date.now() + VISIBLE_FIXTURE_DEADLINE_OFFSET_MS,
    turnActionTimeoutCountBySeatId: { [actorId]: 0 }, autoPlayBySeatId: { [actorId]: false },
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
  await expect(choices.first()).toBeEnabled({ timeout: 5_000 });
  await expect(choices.nth(1)).toBeDisabled();
  await choices.first().click();
  await expect(page.getByTestId('move-piece-button')).toBeEnabled({ timeout: 5_000 });

  const clientFlow = page.evaluate(({ trackedPieceId, initialTurnIndex }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let canonicalSawMo = false;
    let renderedSawMo = false;
    let canonicalRewound = false;
    let renderedRewound = false;
    let sawBackDoOnly = false;
    const getRenderedNodeId = () => {
      const pieceElement = document.querySelector(`[data-testid="piece-${trackedPieceId}"]`);
      if (!(pieceElement instanceof HTMLElement)) return '';
      if (pieceElement.classList.contains('off-board')) return 'n01';
      const nodeElement = [...document.querySelectorAll('[data-testid^="board-node-"]')]
        .find((candidate) => candidate instanceof HTMLElement
          && candidate.style.left === pieceElement.style.left
          && candidate.style.top === pieceElement.style.top);
      return nodeElement?.getAttribute('data-testid')?.replace('board-node-', '') ?? '';
    };
    const sample = () => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const piece = Array.isArray(debug.pieces) ? debug.pieces.find((entry) => entry?.id === trackedPieceId) : null;
      const canonicalNodeId = typeof piece?.nodeId === 'string' ? piece.nodeId : '';
      const renderedNodeId = getRenderedNodeId();
      if (canonicalNodeId === 'n06') canonicalSawMo = true;
      if (renderedNodeId === 'n06') renderedSawMo = true;
      if (canonicalSawMo && canonicalNodeId === 'n01') canonicalRewound = true;
      if (renderedSawMo && renderedNodeId === 'n01') renderedRewound = true;
      if (document.querySelector('.turn-roll-stack-badges')?.getAttribute('aria-label') === '남은 이동 스택: 빽도') sawBackDoOnly = true;
      if (canonicalNodeId === 'n05' && renderedNodeId === 'n05'
        && Number(debug.turnIndex ?? -1) !== initialTurnIndex && !debug.movingPieceId) {
        resolve({ canonicalSawMo, renderedSawMo, canonicalRewound, renderedRewound, sawBackDoOnly });
        return;
      }
      if (performance.now() - startedAt > 20_000) {
        reject(new Error('모 뒤 자동 빽도 이동이 최종 n05 상태로 수렴하지 않았습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { trackedPieceId: pieceId, initialTurnIndex: turnIndex });
  await page.getByTestId('move-piece-button').click();

  await expect.poll(async () => {
    const state = await getRoomStateForQa(roomId);
    const piece = state?.pieces?.find((entry) => entry?.id === pieceId);
    return piece?.nodeId === 'n05' && state?.rollStack?.length === 0 && state?.turnIndex !== turnIndex;
  }, { timeout: 20_000, message: '모 뒤 남은 빽도가 자동 소비된 뒤에만 stack이 비고 상대 턴으로 넘어가야 합니다.' }).toBe(true);
  const observed = await clientFlow;
  expect(observed.canonicalSawMo).toBe(true);
  expect(observed.renderedSawMo).toBe(true);
  expect(observed.sawBackDoOnly).toBe(true);
  expect(observed.canonicalRewound).toBe(false);
  expect(observed.renderedRewound).toBe(false);

  await expect.poll(async () => (await getRoomSequencesForQa(roomId)).slice(baselineSequences.length)
    .filter((sequence) => sequence.type === 'move_piece_resolved' && sequence.actorId === actorId).length,
  { timeout: 20_000, message: '모와 빽도 authoritative move sequence가 각각 하나씩 생성되어야 합니다.' }).toBe(2);
  const moves = (await getRoomSequencesForQa(roomId)).slice(baselineSequences.length)
    .filter((sequence) => sequence.type === 'move_piece_resolved' && sequence.actorId === actorId)
    .sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
  expect(moves).toHaveLength(2);
  expect(moves.map((move) => move.action?.payload?.stackedMoveSelection?.roll?.name)).toEqual(['모', '빽도']);
  expect(new Set(moves.map((move) => move.clientMutationId)).size).toBe(2);
  expect(moves[0].patch?.pieces?.find((piece) => piece?.id === pieceId)?.nodeId).toBe('n06');
  expect(moves[0].patch?.rollStack?.map((roll) => roll?.name)).toEqual(['빽도']);
  expect(moves[0].patch?.turnIndex).toBe(turnIndex);
  expect(moves[1].patch?.pieces?.find((piece) => piece?.id === pieceId)?.nodeId).toBe('n05');
  expect(moves[1].patch?.rollStack ?? []).toHaveLength(0);
  expect(moves[1].patch?.turnIndex).not.toBe(turnIndex);
}
