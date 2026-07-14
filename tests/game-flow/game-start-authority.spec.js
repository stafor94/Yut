import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, joinRoomFromLobby, markGuestReady, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomForQa, getRoomSequencesForQa, getRoomStateForQa, rememberRoomIdFromPage, updateRoomForQa } from '../helpers/rooms.js';

const initSequenceCount = (sequences) => sequences.filter((sequence) => sequence.type === 'game_initialized').length;

async function installStartTransitionTrace(page) {
  await page.evaluate(() => {
    const trace = {
      countdownSeen: false,
      gameSeen: false,
      overlayMissingBeforeGame: false,
      enabledStartButtonBeforeGame: false,
    };
    const inspect = () => {
      const gameVisible = Boolean(document.querySelector('[data-testid="game-screen"]'));
      if (gameVisible) {
        trace.gameSeen = true;
        return;
      }
      const overlayVisible = Boolean(document.querySelector('[data-testid="start-countdown-overlay"], [data-testid="start-transition-overlay"]'));
      if (overlayVisible) trace.countdownSeen = true;
      if (!trace.countdownSeen) return;
      if (!overlayVisible) trace.overlayMissingBeforeGame = true;
      const startButton = document.querySelector('[data-testid="start-game-button"]');
      if (startButton instanceof HTMLButtonElement && !startButton.disabled) trace.enabledStartButtonBeforeGame = true;
    };
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    window.__YUT_QA_START_TRANSITION_TRACE__ = trace;
    window.__YUT_QA_START_TRANSITION_OBSERVER__ = observer;
  });
}

async function readStartTransitionTrace(page) {
  return page.evaluate(() => {
    window.__YUT_QA_START_TRANSITION_OBSERVER__?.disconnect();
    return window.__YUT_QA_START_TRANSITION_TRACE__ ?? null;
  });
}

async function prepareHostAndGuest(browser, testInfo, { hostDelay = {}, guestDelay = {}, label = 'room' } = {}) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'host'));
  const guestName = normalizeQaNickname(makeQaName(testInfo, 'guest'));
  const roomTitle = makeQaName(testInfo, label);
  await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  if (Object.keys(hostDelay).length) await hostContext.addInitScript((delays) => Object.assign(window, delays), hostDelay);
  if (Object.keys(guestDelay).length) await guestContext.addInitScript((delays) => Object.assign(window, delays), guestDelay);
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  await createRoomFromLobby(hostPage, roomTitle);
  const roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
  await joinRoomFromLobby(guestPage, roomTitle);
  await markGuestReady(guestPage);
  await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  return { hostContext, guestContext, hostPage, guestPage, roomId };
}

test.describe('game start authority QA', () => {
  let roomIds;

  test.beforeEach(() => { roomIds = []; });

  test.afterEach(async () => {
    await Promise.allSettled(roomIds.map((roomId) => deleteRoomForQa(roomId)));
  });

  test('게스트 동시 접속에서는 초기 state 저장 후에만 양쪽 화면이 game으로 전환된다', async ({ browser }, testInfo) => {
    const qa = await prepareHostAndGuest(browser, testInfo, {
      hostDelay: { __YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__: 2500 },
      guestDelay: { __YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__: 2500 },
    });
    roomIds.push(qa.roomId);
    try {
      await installStartTransitionTrace(qa.hostPage);
      await runQaStep(testInfo, '초기화 지연 중 대기실 유지', async () => {
        await qa.hostPage.getByTestId('start-game-button').click();
        await expect(qa.hostPage.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 6_000 });
        await expect.poll(async () => {
          const [hostState, guestState, currentState, sequences] = await Promise.all([
            collectScreenState(qa.hostPage),
            collectScreenState(qa.guestPage),
            getRoomStateForQa(qa.roomId),
            getRoomSequencesForQa(qa.roomId),
          ]);
          return {
            hostWaiting: hostState.visibleScreens.waitingRoom,
            hostGame: hostState.visibleScreens.game,
            guestWaiting: guestState.visibleScreens.waitingRoom,
            guestGame: guestState.visibleScreens.game,
            hasCurrentState: Boolean(currentState),
            initializedCount: initSequenceCount(sequences),
          };
        }, { timeout: 2_000 }).toEqual({ hostWaiting: true, hostGame: false, guestWaiting: true, guestGame: false, hasCurrentState: false, initializedCount: 0 });
      });
      await runQaStep(testInfo, '초기 state 적용 후 양쪽 게임 진입', async () => {
        await expect(qa.hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(qa.guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => {
          const [room, state, sequences] = await Promise.all([getRoomForQa(qa.roomId), getRoomStateForQa(qa.roomId), getRoomSequencesForQa(qa.roomId)]);
          return {
            roomVersion: Number(room?.startRequestVersion ?? 0),
            stateVersion: Number(state?.startRequestVersion ?? 0),
            sameRequestId: Boolean(room?.startRequestId && room.startRequestId === state?.startRequestId),
            initializedCount: initSequenceCount(sequences),
          };
        }, { timeout: 5_000 }).toEqual({ roomVersion: 1, stateVersion: 1, sameRequestId: true, initializedCount: 1 });
        expect(await readStartTransitionTrace(qa.hostPage)).toEqual({
          countdownSeen: true,
          gameSeen: true,
          overlayMissingBeforeGame: false,
          enabledStartButtonBeforeGame: false,
        });
      });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });

  test('빠른 3회 클릭과 timeout 재클릭은 동일 requestId로 한 번만 version을 증가시킨다', async ({ browser }, testInfo) => {
    const qa = await prepareHostAndGuest(browser, testInfo, { hostDelay: { __YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__: 2500 } });
    roomIds.push(qa.roomId);
    try {
      const startButton = qa.hostPage.getByTestId('start-game-button');
      await startButton.click();
      await qa.hostPage.evaluate(() => {
        const button = document.querySelector('[data-testid="start-game-button"]');
        if (button instanceof HTMLButtonElement) { button.click(); button.click(); }
      });
      await expect.poll(async () => Number((await getRoomForQa(qa.roomId))?.startRequestVersion ?? 0), { timeout: 1_000 }).toBe(0);
      await expect(startButton).toBeEnabled({ timeout: 2_500 });
      await startButton.click();
      await expect.poll(async () => {
        const room = await getRoomForQa(qa.roomId);
        return { version: Number(room?.startRequestVersion ?? 0), status: String(room?.startStatus ?? ''), requestId: String(room?.startRequestId ?? '') };
      }, { timeout: 5_000 }).toEqual(expect.objectContaining({ version: 1, status: 'requested' }));
      const first = await getRoomForQa(qa.roomId);
      await expect.poll(async () => {
        const room = await getRoomForQa(qa.roomId);
        return { version: Number(room?.startRequestVersion ?? 0), requestId: String(room?.startRequestId ?? '') };
      }, { timeout: 3_000 }).toEqual({ version: 1, requestId: first.startRequestId });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });

  test('timeout 재클릭 후 카운트다운 취소 시 늦은 응답이 와도 초기화되지 않는다', async ({ browser }, testInfo) => {
    const qa = await prepareHostAndGuest(browser, testInfo, { hostDelay: { __YUT_QA_DELAY_REQUEST_ROOM_GAME_START_MS__: 2500 } });
    roomIds.push(qa.roomId);
    try {
      const startButton = qa.hostPage.getByTestId('start-game-button');
      await startButton.click();
      await expect(startButton).toBeEnabled({ timeout: 2_500 });
      await startButton.click();
      await expect(qa.hostPage.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 6_000 });
      await qa.hostPage.getByTestId('cancel-start-button').click();
      await expect.poll(async () => {
        const [room, state, sequences] = await Promise.all([getRoomForQa(qa.roomId), getRoomStateForQa(qa.roomId), getRoomSequencesForQa(qa.roomId)]);
        return { roomStatus: room?.status, startStatus: room?.startStatus, hasState: Boolean(state), initializedCount: initSequenceCount(sequences) };
      }, { timeout: 5_000 }).toEqual({ roomStatus: 'waiting', startStatus: 'cancelled', hasState: false, initializedCount: 0 });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });

  test('초기화 지연 중 cancelled 또는 다른 requestId로 바뀌면 transaction이 거절되고 게임 화면에 진입하지 않는다', async ({ browser }, testInfo) => {
    for (const mode of ['cancelled', 'different-request']) {
      const qa = await prepareHostAndGuest(browser, testInfo, { hostDelay: { __YUT_QA_DELAY_INITIALIZE_GAME_STATE_MS__: 2500 }, label: `room-${mode}` });
      roomIds.push(qa.roomId);
      try {
        await qa.hostPage.getByTestId('start-game-button').click();
        await expect(qa.hostPage.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 6_000 });
        await expect.poll(async () => Number((await getRoomForQa(qa.roomId))?.startRequestVersion ?? 0), { timeout: 5_000 }).toBe(1);
        const room = await getRoomForQa(qa.roomId);
        if (mode === 'cancelled') await updateRoomForQa(qa.roomId, { startStatus: 'cancelled', startCancelledAt: Date.now(), startCountdownUntil: 0 });
        else await updateRoomForQa(qa.roomId, { startRequestId: `${room.startRequestId}-stale-reject` });
        await expect.poll(async () => {
          const [hostState, guestState, currentState, sequences] = await Promise.all([
            collectScreenState(qa.hostPage), collectScreenState(qa.guestPage), getRoomStateForQa(qa.roomId), getRoomSequencesForQa(qa.roomId),
          ]);
          return { hostGame: hostState.visibleScreens.game, guestGame: guestState.visibleScreens.game, hasState: Boolean(currentState), initializedCount: initSequenceCount(sequences) };
        }, { timeout: 5_000 }).toEqual({ hostGame: false, guestGame: false, hasState: false, initializedCount: 0 });
      } finally {
        await qa.guestContext.close();
        await qa.hostContext.close();
      }
    }
  });

  test('만료된 requested 상태에서 새 시작은 새 version과 countdown을 실제 room 문서에 만든다', async ({ browser }, testInfo) => {
    const qa = await prepareHostAndGuest(browser, testInfo);
    roomIds.push(qa.roomId);
    try {
      const expiredStartsAt = Date.now() - 10_000;
      await updateRoomForQa(qa.roomId, {
        startRequestVersion: 7,
        startRequestedAt: expiredStartsAt - 1_000,
        startRequestId: 'expired-requested-for-qa',
        startCountdownStartsAt: expiredStartsAt,
        startCountdownEndsAt: expiredStartsAt + 1_000,
        startCountdownUntil: expiredStartsAt + 1_000,
        startStatus: 'requested',
      });
      await qa.hostPage.getByTestId('start-game-button').click();
      await expect.poll(async () => {
        const room = await getRoomForQa(qa.roomId);
        return {
          version: Number(room?.startRequestVersion ?? 0),
          status: String(room?.startStatus ?? ''),
          hasNewRequestId: Boolean(room?.startRequestId && room.startRequestId !== 'expired-requested-for-qa'),
          hasFutureCountdown: Number(room?.startCountdownEndsAt ?? 0) > Date.now(),
        };
      }, { timeout: 5_000 }).toEqual({ version: 8, status: 'requested', hasNewRequestId: true, hasFutureCountdown: true });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });
});
