import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomForQa, getRoomPlayersForQa, getRoomSeatsForQa, getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

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
          initialEntryPending: Boolean(state.yutDebug?.turnHealth?.initialGameEntryPending),
        };
      }, { timeout: 2_000, message: '카운트다운 표시 중에는 아직 초기 게임 진입 pending을 켜지 않아야 합니다.' }).toEqual({
        overlayVisible: true,
        initialEntryPending: false,
      });
      await expect.poll(async () => {
        const [screenState, room, roomState, sequences] = await Promise.all([
          collectScreenState(page),
          getRoomForQa(roomId),
          getRoomStateForQa(roomId),
          getRoomSequencesForQa(roomId),
        ]);
        const countdownEndsAt = Number(room?.startCountdownEndsAt ?? 0);
        const introReadyAt = Number(roomState?.turnOrderIntro?.readyAt ?? 0);
        return {
          overlayVisible: await page.getByTestId('start-countdown-overlay').isVisible().catch(() => false),
          waitingVisible: screenState.visibleScreens.waitingRoom,
          gameVisible: screenState.visibleScreens.game,
          roomStatus: room?.status,
          startStatus: room?.startStatus,
          hasCurrentState: Boolean(roomState),
          initializedSequenceCount: sequences.filter((sequence) => sequence.type === 'game_initialized').length,
          introStartsAfterCountdown: countdownEndsAt > 0 && introReadyAt > countdownEndsAt,
        };
      }, { timeout: 5_000, message: '취소 잠금 이후에는 카운트다운을 유지한 채 초기 state와 순서 결과를 한 번만 미리 전송해야 합니다.' }).toEqual({
        overlayVisible: true,
        waitingVisible: true,
        gameVisible: false,
        roomStatus: 'waiting',
        startStatus: 'requested',
        hasCurrentState: true,
        initializedSequenceCount: 1,
        introStartsAfterCountdown: true,
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
        };
      }, { timeout: 5_000, message: '카운트다운 종료 후에는 사전 준비된 state로 즉시 게임 화면에 진입해야 합니다.' }).toEqual({
        waitingVisible: false,
        gameVisible: true,
        hasCurrentState: true,
        initializedSequenceCount: 1,
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
      await expect(page.getByTestId('game-board')).toBeVisible();
      await expect(page.locator('.turn-order-ready-overlay.slot-machine')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('turn-indicator')).toBeHidden();
    });

    await runQaStep(testInfo, '모바일 순서 정하기 카드 겹침 확인', async () => {
      const originalViewport = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      const overlay = page.locator('.turn-order-ready-overlay.slot-machine');
      const slotList = page.getByTestId('turn-order-slot-list');
      await expect(overlay).toBeVisible({ timeout: 10_000 });
      await expect(slotList).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('turn-indicator')).toBeHidden();

      const layout = await overlay.evaluate((element) => {
        const toBox = (target) => {
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const windows = Array.from(element.querySelectorAll('.turn-order-slot-window'));
        const style = getComputedStyle(element);
        return {
          overlayBox: toBox(element),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          borderWidth: Number.parseFloat(style.borderTopWidth),
          backgroundImage: style.backgroundImage,
          windowBoxes: windows.map(toBox),
          windowOverflow: windows.map((target) => getComputedStyle(target).overflow),
        };
      });

      expect(layout.borderWidth, '순서 정하기 팝업은 두꺼운 목재 프레임을 사용해야 합니다.').toBeGreaterThanOrEqual(5);
      expect(layout.backgroundImage, '순서 정하기 팝업은 입체 그라데이션 표면을 사용해야 합니다.').toContain('gradient');
      expect(layout.overlayBox.x, '순서 정하기 팝업 왼쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.overlayBox.y, '순서 정하기 팝업 위쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.overlayBox.x + layout.overlayBox.width, '순서 정하기 팝업 오른쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.width);
      expect(layout.overlayBox.y + layout.overlayBox.height, '순서 정하기 팝업 아래쪽이 뷰포트 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewport.height);
      expect(layout.windowBoxes.length, '2인 순서 정하기에는 슬롯 카드 2개가 있어야 합니다.').toBe(2);
      expect(layout.windowOverflow.every((value) => value === 'hidden'), '각 슬롯은 회전 중인 다른 카드를 경계 안에서 잘라야 합니다.').toBe(true);

      for (let index = 0; index < layout.windowBoxes.length; index += 1) {
        const box = layout.windowBoxes[index];
        expect(box.x, '슬롯 카드가 팝업 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(layout.overlayBox.x);
        expect(box.x + box.width, '슬롯 카드가 팝업 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.overlayBox.x + layout.overlayBox.width);
        if (index > 0) expect(boxesOverlap(layout.windowBoxes[index - 1], box), '순서 슬롯 카드끼리 겹치면 안 됩니다.').toBe(false);
      }

      if (originalViewport) await page.setViewportSize(originalViewport);
    });

    await runQaStep(testInfo, '모바일 인게임 상단 레이아웃 겹침 확인', async () => {
      const originalViewport = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      const header = page.locator('.game-shell .hero');
      await expect(header).toBeVisible();

      const layout = await header.evaluate((element) => {
        const timer = element.querySelector('.play-time');
        const actions = element.querySelector('.hero-actions');
        const buttons = actions ? Array.from(actions.querySelectorAll('button')) : [];
        const toBox = (target) => {
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          display: getComputedStyle(element).display,
          headerBox: toBox(element),
          timerBox: toBox(timer),
          actionsBox: toBox(actions),
          buttonBoxes: buttons.map(toBox),
        };
      });

      expect(layout.display, '인게임 상단은 명시적인 grid 레이아웃이어야 합니다.').toBe('grid');
      expect(layout.headerBox, '상단 패널 bounding box').not.toBeNull();
      expect(layout.timerBox, '플레이 타이머 bounding box').not.toBeNull();
      expect(layout.actionsBox, '상단 액션 영역 bounding box').not.toBeNull();
      expect(layout.buttonBoxes, '닉네임·효과음·서버 상태 버튼 3개가 있어야 합니다.').toHaveLength(3);

      const { headerBox, timerBox, actionsBox, buttonBoxes } = layout;
      expect(timerBox.y, '모바일에서는 타이머가 상단 액션 영역 아래에 배치되어야 합니다.').toBeGreaterThanOrEqual(actionsBox.y + actionsBox.height - 1);
      expect(timerBox.x, '타이머가 상단 패널 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(headerBox.x);
      expect(timerBox.x + timerBox.width, '타이머가 상단 패널 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(headerBox.x + headerBox.width);

      for (const buttonBox of buttonBoxes) {
        expect(buttonBox.x, '상단 버튼이 액션 영역 왼쪽 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(actionsBox.x - 1);
        expect(buttonBox.x + buttonBox.width, '상단 버튼이 액션 영역 오른쪽 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(actionsBox.x + actionsBox.width + 1);
        expect(Math.abs(buttonBox.y - buttonBoxes[0].y), '상단 버튼 3개는 같은 행에 정렬되어야 합니다.').toBeLessThanOrEqual(1);
      }

      for (let leftIndex = 0; leftIndex < buttonBoxes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < buttonBoxes.length; rightIndex += 1) {
          expect(boxesOverlap(buttonBoxes[leftIndex], buttonBoxes[rightIndex]), '상단 버튼끼리 겹치면 안 됩니다.').toBe(false);
        }
      }

      if (originalViewport) await page.setViewportSize(originalViewport);
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

      await expect(page.getByTestId('turn-indicator')).toBeVisible();
      await expect(page.getByTestId('players-panel')).toContainText(hostName);
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
