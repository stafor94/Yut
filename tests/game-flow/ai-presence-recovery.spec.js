import { test, expect } from '@playwright/test';
import {
  createRoomFromLobby,
  expectAppShell,
  joinRoomFromLobby,
  markGuestReady,
  primeLobbyStorage,
} from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import {
  deleteRoomForQa,
  findRoomIdByTitle,
  getRoomPlayersForQa,
  getRoomSeatsForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

async function prepareGame(browser, testInfo) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostName = normalizeQaNickname(`H-${makeQaName(testInfo, 'stale-host')}`);
  const guestName = normalizeQaNickname(`G-${makeQaName(testInfo, 'stale-guest')}`);
  const roomTitle = makeQaName(testInfo, 'stale-room');
  await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  await createRoomFromLobby(hostPage, roomTitle);
  const roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
  expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();
  await joinRoomFromLobby(guestPage, roomTitle);
  await markGuestReady(guestPage);
  await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await hostPage.getByTestId('start-game-button').click();
  await expect(hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
  await expect(guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
  const players = await getRoomPlayersForQa(roomId);
  const guestPlayerId = players.find((player) => player.nickname === guestName)?.id ?? '';
  expect(guestPlayerId, '연결 만료시킬 게스트 player id가 필요합니다.').toBeTruthy();
  return { hostContext, guestContext, hostPage, guestPage, guestName, guestPlayerId, roomId };
}

async function readPresenceControl(roomId, playerId) {
  const [players, seats, state] = await Promise.all([
    getRoomPlayersForQa(roomId),
    getRoomSeatsForQa(roomId),
    getRoomStateForQa(roomId),
  ]);
  const player = players.find((candidate) => candidate.id === playerId);
  const seat = seats.find((candidate) => candidate.originalPlayerId === playerId || candidate.currentPlayerId === playerId || candidate.playerId === playerId);
  const gameSeat = Array.isArray(state?.gameSeats)
    ? state.gameSeats.find((candidate) => candidate.id === playerId || Number(candidate.seatIndex) === Number(player?.seatIndex))
    : null;
  return {
    player: player ? {
      isAI: player.isAI === true,
      isSubstitutedByAI: player.isSubstitutedByAI === true,
      presenceEpoch: Number(player.presenceEpoch ?? 0),
    } : null,
    seat: seat ? {
      aiActive: seat.aiActive === true,
      isSubstitutedByAI: seat.isSubstitutedByAI === true,
      status: seat.status,
      presenceEpoch: Number(seat.presenceEpoch ?? 0),
    } : null,
    gameSeat: gameSeat ? {
      isAI: gameSeat.isAI === true,
      isSubstitutedByAI: gameSeat.isSubstitutedByAI === true,
      presenceEpoch: Number(gameSeat.presenceEpoch ?? 0),
    } : null,
  };
}

test.describe('stale presence AI substitution recovery', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('heartbeat가 끊긴 플레이어도 AI 대체 후 같은 계정 재접속으로 제어권을 회수한다', async ({ browser }, testInfo) => {
    test.setTimeout(140_000);
    const qa = await prepareGame(browser, testInfo);
    roomId = qa.roomId;
    try {
      await qa.guestPage.close();

      let substitutedEpoch = 0;
      await expect.poll(async () => {
        const control = await readPresenceControl(qa.roomId, qa.guestPlayerId);
        substitutedEpoch = control.player?.presenceEpoch ?? 0;
        return control;
      }, { timeout: 75_000, intervals: [1_000, 2_000, 5_000] }).toEqual({
        player: { isAI: true, isSubstitutedByAI: true, presenceEpoch: expect.any(Number) },
        seat: { aiActive: true, isSubstitutedByAI: true, status: 'ai_substitute', presenceEpoch: expect.any(Number) },
        gameSeat: { isAI: true, isSubstitutedByAI: true, presenceEpoch: expect.any(Number) },
      });
      const substitutedControl = await readPresenceControl(qa.roomId, qa.guestPlayerId);
      expect(substitutedEpoch).toBeGreaterThan(0);
      expect(substitutedControl.seat?.presenceEpoch).toBe(substitutedEpoch);
      expect(substitutedControl.gameSeat?.presenceEpoch).toBe(substitutedEpoch);

      const recoveredPage = await qa.guestContext.newPage();
      await expectAppShell(recoveredPage);
      await expect(recoveredPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

      await expect.poll(async () => readPresenceControl(qa.roomId, qa.guestPlayerId), { timeout: 15_000 }).toEqual({
        player: { isAI: false, isSubstitutedByAI: false, presenceEpoch: expect.any(Number) },
        seat: { aiActive: false, isSubstitutedByAI: false, status: 'human', presenceEpoch: expect.any(Number) },
        gameSeat: { isAI: false, isSubstitutedByAI: false, presenceEpoch: expect.any(Number) },
      });
      const restoredControl = await readPresenceControl(qa.roomId, qa.guestPlayerId);
      const restoredEpoch = restoredControl.player?.presenceEpoch ?? 0;
      expect(restoredEpoch).toBeGreaterThan(substitutedEpoch);
      expect(restoredControl.seat?.presenceEpoch).toBe(restoredEpoch);
      expect(restoredControl.gameSeat?.presenceEpoch).toBe(restoredEpoch);
      await expect(qa.hostPage.locator('.game-player-card.ai').filter({ hasText: qa.guestName })).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });
});
