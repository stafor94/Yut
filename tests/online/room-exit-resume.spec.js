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
import { collectScreenState, createRoomFromLobby, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';

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
        const spectator = players.find((player) => player.nickname === spectatorName);
        expect(spectator?.id, '관전자 player id가 필요합니다.').toBeTruthy();
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
