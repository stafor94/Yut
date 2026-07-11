import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomForQa, getRoomPlayersForQa, getRoomSeatsForQa, getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('game flow QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('AI를 추가한 2인 방에서 게임 화면 진입과 첫 턴 조작 UI를 검증한다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'host'));
    const roomTitle = makeQaName(testInfo, 'room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__ = 2500;
      window.__YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__ = 2500;
      window.__YUT_QA_DELAY_AFTER_ROOM_PLAYER_SAVE_MS__ = 2500;
    });

    await runQaStep(testInfo, '방 생성', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room'), `대기실 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
    });

    await runQaStep(testInfo, 'AI 추가 후 게임 시작', async () => {
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button'), 'AI player 문서만 먼저 반영되고 seat/room 후속 갱신이 지연되는 동안 시작 버튼은 비활성 상태여야 합니다.').toBeDisabled({ timeout: 1_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        const room = await getRoomForQa(roomId);
        const players = await getRoomPlayersForQa(roomId);
        const seats = await getRoomSeatsForQa(roomId);
        const aiPlayer = players.find((player) => player.seatIndex === 1 && player.isAI);
        const aiSeat = seats.find((seat) => Number(seat.seatIndex ?? seat.id) === 1);
        return {
          playerAiVisible: Boolean(aiPlayer),
          seatAiActive: Boolean(aiSeat?.aiActive),
          roomCurrentPlayers: Number(room?.currentPlayers ?? 0),
          pendingAiSeatCount: Number(state.yutDebug?.pendingAiSeatCount ?? 0),
          allReady: Boolean(state.yutDebug?.allReady),
          startDisabled: Boolean(state.startButton.disabled),
        };
      }, { timeout: 2_000, message: 'player.isAI snapshot을 받아도 pending AI 상태와 시작 버튼 비활성 상태가 유지되어야 합니다.' }).toEqual({
        playerAiVisible: true,
        seatAiActive: false,
        roomCurrentPlayers: 1,
        pendingAiSeatCount: 1,
        allReady: false,
        startDisabled: true,
      });
      await expect(page.getByTestId('start-game-button'), `시작 버튼 상태: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeEnabled({ timeout: 15_000 });
      const startButton = page.getByTestId('start-game-button');
      await startButton.click();
      await expect(page.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('app-shell')).toHaveClass(/countdown-active/, { timeout: 5_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        return {
          overlayVisible: await page.getByTestId('start-countdown-overlay').isVisible().catch(() => false),
          initialEntryPending: Boolean(state.yutDebug?.syncPipeline?.initialGameEntryPending),
        };
      }, { timeout: 2_000, message: '카운트다운 표시 중에는 아직 초기 게임 진입 pending을 켜지 않아야 합니다.' }).toEqual({
        overlayVisible: true,
        initialEntryPending: false,
      });
      await expect(page.getByTestId('start-countdown-overlay')).toBeHidden({ timeout: 5_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        const roomState = await getRoomStateForQa(roomId);
        const sequences = await getRoomSequencesForQa(roomId);
        return {
          waitingVisible: state.visibleScreens.waitingRoom,
          gameVisible: state.visibleScreens.game,
          hasCurrentState: Boolean(roomState),
          initializedSequenceCount: sequences.filter((sequence) => sequence.type === 'game_initialized').length,
          initialEntryPending: Boolean(state.yutDebug?.syncPipeline?.initialGameEntryPending),
        };
      }, { timeout: 2_500, message: '카운트다운 종료 후 초기화 지연 중에는 pending만 켜고 대기실/state 없음 상태를 유지해야 합니다.' }).toEqual({
        waitingVisible: true,
        gameVisible: false,
        hasCurrentState: false,
        initializedSequenceCount: 0,
        initialEntryPending: true,
      });
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('start-countdown-overlay')).toBeHidden({ timeout: 5_000 });
      await expect(page.locator('.countdown-scrim')).toHaveCount(0);
      await expect(page.getByTestId('app-shell')).not.toHaveClass(/countdown-active/);
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        return {
          gameVisible: state.visibleScreens.game,
          countdownActive: /(?:^|\s)countdown-active(?:\s|$)/.test(await page.getByTestId('app-shell').getAttribute('class') ?? ''),
          scrimCount: await page.locator('.countdown-scrim').count(),
          overlayVisible: await page.getByTestId('start-countdown-overlay').isVisible().catch(() => false),
        };
      }, { timeout: 2_000, message: '초기 게임 상태 저장 후 게임 화면에는 카운트다운 흐림/팝업이 남지 않아야 합니다.' }).toEqual({
        gameVisible: true,
        countdownActive: false,
        scrimCount: 0,
        overlayVisible: false,
      });
      await expect(page.getByTestId('players-panel')).toContainText(hostName);
      await expect(page.getByTestId('turn-indicator')).toBeVisible();
      await expect(page.getByTestId('game-board')).toBeVisible();
    });

    await runQaStep(testInfo, '순서 정하기 완료 및 첫 턴 진행 가능 상태 확인', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        const debug = state.yutDebug ?? {};
        const hasTurnOrder = Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length >= 2;
        const orderingCleared = !debug.turnOrderPhase?.active && !debug.turnOrderIntro && !state.turnOrder.phaseOverlayVisible && !state.turnOrder.introOverlayVisible && !state.turnOrder.lockVisible;
        if (hasTurnOrder && orderingCleared) return 'resolved';
        return JSON.stringify(state, null, 2);
      }, { timeout: 35_000, message: '순서 정하기가 완료되고 대기/오버레이가 사라져야 합니다.' }).toBe('resolved');

      await expect.poll(async () => {
        const state = await collectScreenState(page);
        const debug = state.yutDebug ?? {};
        const initialSave = debug.syncPipeline?.initialGameStateSave ?? {};
        const sequences = await getRoomSequencesForQa(roomId);
        const latestSequence = Math.max(0, ...sequences.map((sequence) => Number(sequence.sequence ?? sequence.id ?? 0)));
        const actionableRoll = state.rollButton.visible && !state.rollButton.disabled;
        const actionableMove = state.moveButton.visible && !state.moveButton.disabled;
        const waitingForOtherTurn = state.turnWaitingButton.visible;
        const saveCommitted = initialSave.status === 'committed' || initialSave.status === 'duplicate';
        const initializedSequences = sequences.filter((sequence) => sequence.type === 'game_initialized');
        const singleInitialization = initializedSequences.length === 1;
        const sequenceApplied = Number(debug.syncPipeline?.lastAppliedSequence ?? debug.lastAppliedSequence ?? 0) >= 1 && Number(initialSave.lastSequence ?? latestSequence) >= 1;
        if (saveCommitted && sequenceApplied && singleInitialization && (actionableRoll || actionableMove || waitingForOtherTurn)) return 'ready';
        return JSON.stringify({ state, latestSequence, initializedSequenceCount: initializedSequences.length }, null, 2);
      }, { timeout: 20_000, message: '초기 state/sequences 저장 후 첫 턴 조작/대기 UI가 보여야 합니다.' }).toBe('ready');
    });
  });
});
