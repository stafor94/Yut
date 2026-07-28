import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import {
  deleteRoomForQa,
  findRoomIdByTitle,
  getRoomForQa,
  getRoomPlayersForQa,
  getRoomSeatsForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';
import {
  collectScreenState,
  createRoomFromLobby,
  expectAppShell,
  joinRoomFromLobby,
  markGuestReady,
  primeLobbyStorage,
  runQaStep,
} from '../helpers/ui.js';

async function addAiAndStart(page) {
  await page.getByTestId('add-ai-P2').click();
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    return {
      pendingAiSeatCount: Number(state.yutDebug?.pendingAiSeatCount ?? 0),
      allReady: Boolean(state.yutDebug?.allReady),
      startDisabled: Boolean(state.startButton.disabled),
    };
  }, { timeout: 25_000 }).toEqual({ pendingAiSeatCount: 0, allReady: true, startDisabled: false });
  await page.getByTestId('start-game-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
}

async function openRoomAction(page, roomTitle, expectedText) {
  await page.getByRole('button', { name: '방 참가', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '방 참가' })).toBeVisible();
  const loading = page.getByTestId('room-list-loading');
  await expect(loading).toBeHidden({ timeout: 25_000 });
  const roomCard = page.locator('.lobby-room-card').filter({ hasText: roomTitle }).first();
  await expect(roomCard).toBeVisible({ timeout: 25_000 });
  const action = roomCard.locator('.lobby-room-action');
  await expect(action).toHaveText(expectedText, { timeout: 10_000 });
  await expect(action).toBeEnabled();
  return action;
}

async function readPlayerControlState(roomId, playerId) {
  const [room, players, seats, state] = await Promise.all([
    getRoomForQa(roomId),
    getRoomPlayersForQa(roomId),
    getRoomSeatsForQa(roomId),
    getRoomStateForQa(roomId),
  ]);
  const matchingPlayers = players.filter((player) => player.id === playerId);
  const player = matchingPlayers[0];
  const seat = seats.find((candidate) => [candidate.playerId, candidate.originalPlayerId, candidate.currentPlayerId].includes(playerId));
  const gameSeats = Array.isArray(state?.gameSeats) ? state.gameSeats : [];
  const gameSeat = gameSeats.find((candidate) => candidate.id === playerId || Number(candidate.seatIndex) === Number(player?.seatIndex));
  return {
    currentPlayers: Number(room?.currentPlayers ?? -1),
    matchingPlayerCount: matchingPlayers.length,
    player: player ? {
      seatIndex: Number(player.seatIndex),
      isAI: player.isAI === true,
      isSubstitutedByAI: player.isSubstitutedByAI === true,
      isSpectator: player.isSpectator === true,
    } : null,
    seat: seat ? {
      seatIndex: Number(seat.seatIndex),
      aiActive: seat.aiActive === true,
      isSubstitutedByAI: seat.isSubstitutedByAI === true,
      status: seat.status,
    } : null,
    gameSeat: gameSeat ? {
      seatIndex: Number(gameSeat.seatIndex),
      isAI: gameSeat.isAI === true,
      isSubstitutedByAI: gameSeat.isSubstitutedByAI === true,
    } : null,
  };
}

async function readSpectatorState(roomId, spectatorId) {
  const [room, players, seats, state] = await Promise.all([
    getRoomForQa(roomId),
    getRoomPlayersForQa(roomId),
    getRoomSeatsForQa(roomId),
    getRoomStateForQa(roomId),
  ]);
  const matchingPlayers = players.filter((player) => player.id === spectatorId);
  const spectator = matchingPlayers[0];
  const hasSeat = seats.some((seat) => [seat.playerId, seat.originalPlayerId, seat.currentPlayerId].includes(spectatorId));
  const hasGameSeat = Array.isArray(state?.gameSeats) && state.gameSeats.some((seat) => seat.id === spectatorId);
  return {
    currentPlayers: Number(room?.currentPlayers ?? -1),
    matchingPlayerCount: matchingPlayers.length,
    isSpectator: spectator?.isSpectator === true,
    hasSeat,
    hasGameSeat,
  };
}

function normalizeTurnIndex(turnIndex, seatCount) {
  if (!seatCount) return -1;
  return ((Math.trunc(Number(turnIndex) || 0) % seatCount) + seatCount) % seatCount;
}

async function readAuthoritativeTurn(roomId) {
  const state = await getRoomStateForQa(roomId);
  const turnOrderIds = Array.isArray(state?.turnOrderIds) ? state.turnOrderIds.map(String) : [];
  const gameSeats = Array.isArray(state?.gameSeats) ? state.gameSeats : [];
  const seatById = new Map(gameSeats.map((seat) => [String(seat.id), seat]));
  const missingSeatIds = turnOrderIds.filter((seatId) => !seatById.has(seatId));
  const index = normalizeTurnIndex(state?.turnIndex, turnOrderIds.length);
  const currentId = index >= 0 ? turnOrderIds[index] : '';
  const previousId = index >= 0 ? turnOrderIds[(index - 1 + turnOrderIds.length) % turnOrderIds.length] : '';
  const nextId = index >= 0 ? turnOrderIds[(index + 1) % turnOrderIds.length] : '';
  const toSeat = (seatId) => {
    const seat = seatById.get(seatId);
    return seat ? { id: seatId, name: String(seat.name ?? ''), seatIndex: Number(seat.seatIndex) } : null;
  };
  return {
    turnIndex: Number(state?.turnIndex ?? 0),
    lastSequence: Number(state?.lastSequence ?? 0),
    turnOrderIds,
    missingSeatIds,
    current: toSeat(currentId),
    previous: toSeat(previousId),
    next: toSeat(nextId),
  };
}

async function expectAuthoritativeTurnPresentation(page, roomId, localPlayerId) {
  await expect.poll(async () => {
    const [authoritative, client] = await Promise.all([readAuthoritativeTurn(roomId), collectScreenState(page)]);
    const clientSeatIds = new Set((client.yutDebug?.seats ?? []).map((seat) => String(seat.id)));
    return {
      authoritativeReady: authoritative.turnOrderIds.length >= 2 && authoritative.missingSeatIds.length === 0 && Boolean(authoritative.current?.name),
      allIdsResolved: authoritative.turnOrderIds.every((seatId) => clientSeatIds.has(seatId)),
      activeSeatId: String(client.yutDebug?.activeSeat?.id ?? ''),
      expectedActiveSeatId: String(authoritative.current?.id ?? ''),
      waitingForTurnOrder: Boolean(client.yutDebug?.waitingForOnlineTurnOrder),
    };
  }, { timeout: 25_000 }).toEqual(expect.objectContaining({
    authoritativeReady: true,
    allIdsResolved: true,
    waitingForTurnOrder: false,
  }));

  const authoritative = await readAuthoritativeTurn(roomId);
  await expect(page.locator('.turn-current-badge')).toHaveText(authoritative.current.name, { timeout: 10_000 });
  await expect(page.locator('.previous-turn')).toHaveText(authoritative.previous.name, { timeout: 10_000 });
  await expect(page.locator('.next-turn')).toHaveText(authoritative.next.name, { timeout: 10_000 });

  await expect.poll(async () => {
    const [latestAuthoritative, client] = await Promise.all([readAuthoritativeTurn(roomId), collectScreenState(page)]);
    const expectedCurrentId = String(latestAuthoritative.current?.id ?? '');
    const isLocalTurn = expectedCurrentId === localPlayerId;
    const hasActionableRoll = client.rollButton.visible && !client.rollButton.disabled;
    const hasActionableMove = client.moveButton.visible && !client.moveButton.disabled;
    return {
      activeSeatMatches: String(client.yutDebug?.activeSeat?.id ?? '') === expectedCurrentId,
      myTurnMatches: Boolean(client.yutDebug?.isMyTurn) === isLocalTurn,
      actionPermissionMatches: isLocalTurn
        ? hasActionableRoll || hasActionableMove
        : !hasActionableRoll && !hasActionableMove,
      localWaitingHidden: !isLocalTurn || !client.turnWaitingButton.visible,
    };
  }, { timeout: 15_000 }).toEqual({
    activeSeatMatches: true,
    myTurnMatches: true,
    actionPermissionMatches: true,
    localWaitingHidden: true,
  });
  return readAuthoritativeTurn(roomId);
}

async function completeAuthoritativeTurn({ roomId, hostPage, guestPage, hostPlayerId, guestPlayerId }) {
  const before = await readAuthoritativeTurn(roomId);
  const activePage = before.current.id === hostPlayerId ? hostPage : before.current.id === guestPlayerId ? guestPage : null;
  expect(activePage, '현재 authoritative seat에 대응하는 실제 사람 페이지가 필요합니다.').toBeTruthy();
  const rollButton = activePage.getByTestId('roll-yut-button');
  await expect(rollButton).toBeEnabled({ timeout: 20_000 });
  await rollButton.click();
  const moveButton = activePage.getByTestId('move-piece-button');
  await expect(moveButton).toBeEnabled({ timeout: 20_000 });
  await moveButton.click();
  await expect.poll(async () => {
    const after = await readAuthoritativeTurn(roomId);
    return {
      sequenceAdvanced: after.lastSequence > before.lastSequence,
      turnChanged: after.current?.id !== before.current?.id,
    };
  }, { timeout: 25_000 }).toEqual({ sequenceAdvanced: true, turnChanged: true });
}

async function installTurnBadgeTrace(page) {
  await page.evaluate(() => {
    const values = [];
    const capture = () => {
      const value = document.querySelector('.turn-current-badge')?.textContent?.trim() ?? '';
      if (value && values[values.length - 1] !== value) values.push(value);
    };
    capture();
    const observer = new MutationObserver(capture);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    window.__YUT_QA_TURN_BADGE_TRACE__ = values;
    window.__YUT_QA_TURN_BADGE_OBSERVER__ = observer;
  });
}

async function readTurnBadgeTrace(page) {
  return page.evaluate(() => {
    window.__YUT_QA_TURN_BADGE_OBSERVER__?.disconnect();
    return window.__YUT_QA_TURN_BADGE_TRACE__ ?? [];
  });
}

test.describe('in-game reconnect, rejoin, and spectator entry QA', () => {
  test('사람 플레이어 새로고침과 명시적 퇴장 후 재참가는 같은 좌석과 사람 제어 상태를 복구한다', async ({ page, context }, testInfo) => {
    test.setTimeout(150_000);
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);

    const nickname = normalizeQaNickname(makeQaName(testInfo, 'resume-player'));
    const roomTitle = makeQaName(testInfo, 'resume-room');
    let roomId;

    await primeLobbyStorage(context, { nickname, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, '인게임 새로고침과 명시적 퇴장 후 재참가의 좌석·문서·인원 복구 확인', async () => {
      try {
        await createRoomFromLobby(page, roomTitle);
        roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
        expect(roomId, 'QA 방 ID가 필요합니다.').toBeTruthy();
        await addAiAndStart(page);

        const initialPlayers = await getRoomPlayersForQa(roomId);
        const localPlayer = initialPlayers.find((player) => player.nickname === nickname && player.isSpectator !== true);
        expect(localPlayer?.id, '새로고침할 사람 player id가 필요합니다.').toBeTruthy();
        const playerId = localPlayer.id;
        const seatIndex = Number(localPlayer.seatIndex);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => readPlayerControlState(roomId, playerId), { timeout: 15_000 }).toEqual({
          currentPlayers: 1,
          matchingPlayerCount: 1,
          player: { seatIndex, isAI: false, isSubstitutedByAI: false, isSpectator: false },
          seat: { seatIndex, aiActive: false, isSubstitutedByAI: false, status: 'human' },
          gameSeat: { seatIndex, isAI: false, isSubstitutedByAI: false },
        });

        await page.getByTestId('game-end-button').click();
        const endDialog = page.getByRole('dialog', { name: '게임 종료 확인' });
        await expect(endDialog).toBeVisible();
        await endDialog.getByRole('button', { name: '게임 종료', exact: true }).click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });

        await expect.poll(async () => readPlayerControlState(roomId, playerId), { timeout: 15_000 }).toMatchObject({
          currentPlayers: 0,
          matchingPlayerCount: 1,
          player: { seatIndex, isAI: true, isSubstitutedByAI: true, isSpectator: false },
          seat: { seatIndex, aiActive: true, isSubstitutedByAI: true, status: 'ai_substitute' },
          gameSeat: { seatIndex, isAI: true, isSubstitutedByAI: true },
        });

        const action = await openRoomAction(page, roomTitle, '참가');
        await action.click();
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => readPlayerControlState(roomId, playerId), { timeout: 15_000 }).toEqual({
          currentPlayers: 1,
          matchingPlayerCount: 1,
          player: { seatIndex, isAI: false, isSubstitutedByAI: false, isSpectator: false },
          seat: { seatIndex, aiActive: false, isSubstitutedByAI: false, status: 'human' },
          gameSeat: { seatIndex, isAI: false, isSubstitutedByAI: false },
        });
      } finally {
        if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
      }
    });
  });

  test('P2 재입장 후 authoritative 현재·이전·다음 턴과 행동 권한이 두 턴 이상 계속 일치한다', async ({ browser }, testInfo) => {
    test.setTimeout(210_000);
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);

    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'turn-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'turn-guest'));
    const roomTitle = makeQaName(testInfo, 'reentry-ai-seq-room');
    let roomId;

    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    await runQaStep(testInfo, '비-P1 재입장과 authoritative 턴 표시·행동 권한의 지속 일치 확인', async () => {
      try {
        await createRoomFromLobby(hostPage, roomTitle);
        roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
        expect(roomId, 'QA 방 ID가 필요합니다.').toBeTruthy();
        await joinRoomFromLobby(guestPage, roomTitle);
        await markGuestReady(guestPage);
        await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
        await hostPage.getByTestId('start-game-button').click();
        await expect(hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

        const players = await getRoomPlayersForQa(roomId);
        const hostPlayer = players.find((player) => player.nickname === hostName && player.isSpectator !== true);
        const guestPlayer = players.find((player) => player.nickname === guestName && player.isSpectator !== true);
        expect(hostPlayer?.id, 'P1 player id가 필요합니다.').toBeTruthy();
        expect(guestPlayer?.id, 'P2 player id가 필요합니다.').toBeTruthy();
        expect(Number(guestPlayer.seatIndex)).toBe(1);

        await expectAuthoritativeTurnPresentation(hostPage, roomId, hostPlayer.id);
        await expectAuthoritativeTurnPresentation(guestPage, roomId, guestPlayer.id);

        await guestPage.getByTestId('game-end-button').click();
        const endDialog = guestPage.getByRole('dialog', { name: '게임 종료 확인' });
        await expect(endDialog).toBeVisible();
        await endDialog.getByRole('button', { name: '게임 종료', exact: true }).click();
        await expect(guestPage.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => readPlayerControlState(roomId, guestPlayer.id), { timeout: 15_000 }).toMatchObject({
          player: { seatIndex: 1, isAI: true, isSubstitutedByAI: true, isSpectator: false },
          gameSeat: { seatIndex: 1, isAI: true, isSubstitutedByAI: true },
        });

        await installTurnBadgeTrace(guestPage);
        const action = await openRoomAction(guestPage, roomTitle, '참가');
        await action.click();
        await expect(guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => readPlayerControlState(roomId, guestPlayer.id), { timeout: 15_000 }).toEqual({
          currentPlayers: 2,
          matchingPlayerCount: 1,
          player: { seatIndex: 1, isAI: false, isSubstitutedByAI: false, isSpectator: false },
          seat: { seatIndex: 1, aiActive: false, isSubstitutedByAI: false, status: 'human' },
          gameSeat: { seatIndex: 1, isAI: false, isSubstitutedByAI: false },
        });

        await expectAuthoritativeTurnPresentation(hostPage, roomId, hostPlayer.id);
        await expectAuthoritativeTurnPresentation(guestPage, roomId, guestPlayer.id);
        const reentryTrace = await readTurnBadgeTrace(guestPage);
        expect(reentryTrace.some((value) => /플레이어|host/i.test(value)), `재입장 중 가짜 placeholder 턴이 노출되면 안 됩니다: ${reentryTrace.join(' | ')}`).toBe(false);

        for (let completedTurns = 0; completedTurns < 2; completedTurns += 1) {
          await completeAuthoritativeTurn({
            roomId,
            hostPage,
            guestPage,
            hostPlayerId: hostPlayer.id,
            guestPlayerId: guestPlayer.id,
          });
          await expectAuthoritativeTurnPresentation(hostPage, roomId, hostPlayer.id);
          await expectAuthoritativeTurnPresentation(guestPage, roomId, guestPlayer.id);
        }
      } finally {
        if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
        await guestContext.close();
        await hostContext.close();
      }
    });
  });

  test('다른 계정은 관전자로 입장하고 새로고침해도 같은 관전자 문서를 재사용한다', async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);

    const hostContext = await browser.newContext();
    const spectatorContext = await browser.newContext();
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'spectator-host'));
    const spectatorName = normalizeQaNickname(makeQaName(testInfo, 'spectator-user'));
    const roomTitle = makeQaName(testInfo, 'spectator-room');
    let roomId;

    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await primeLobbyStorage(spectatorContext, { nickname: spectatorName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    const hostPage = await hostContext.newPage();
    const spectatorPage = await spectatorContext.newPage();

    await runQaStep(testInfo, '관전 입장과 관전자 새로고침의 문서·좌석·인원 불변 확인', async () => {
      try {
        await createRoomFromLobby(hostPage, roomTitle);
        roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
        expect(roomId, 'QA 방 ID가 필요합니다.').toBeTruthy();
        await addAiAndStart(hostPage);

        await expectAppShell(spectatorPage);
        const action = await openRoomAction(spectatorPage, roomTitle, '관전');
        await action.click();
        await expect(spectatorPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

        const players = await getRoomPlayersForQa(roomId);
        const spectatorPlayers = players.filter((player) => player.isSpectator === true);
        expect(spectatorPlayers, '관전자 player 문서는 하나만 생성되어야 합니다.').toHaveLength(1);
        const spectator = spectatorPlayers[0];
        expect(spectator.nickname).toBe(spectatorName);
        const spectatorId = spectator.id;

        await expect.poll(async () => readSpectatorState(roomId, spectatorId), { timeout: 15_000 }).toEqual({
          currentPlayers: 1,
          matchingPlayerCount: 1,
          isSpectator: true,
          hasSeat: false,
          hasGameSeat: false,
        });
        await expect.poll(async () => {
          const state = await collectScreenState(spectatorPage);
          return state.rollButton.visible ? state.rollButton.disabled : true;
        }, { timeout: 15_000 }).toBe(true);

        await spectatorPage.reload({ waitUntil: 'domcontentloaded' });
        await expect(spectatorPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => readSpectatorState(roomId, spectatorId), { timeout: 15_000 }).toEqual({
          currentPlayers: 1,
          matchingPlayerCount: 1,
          isSpectator: true,
          hasSeat: false,
          hasGameSeat: false,
        });
      } finally {
        if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
        await spectatorContext.close();
        await hostContext.close();
      }
    });
  });
});
