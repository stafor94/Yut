import { test, expect } from '@playwright/test';
import {
  createRoomFromLobby,
  joinRoomFromLobby,
  markGuestReady,
  primeLobbyStorage,
  runQaStep,
} from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import {
  deleteRoomForQa,
  findRoomIdByTitle,
  getRoomPlayersForQa,
  getRoomSeatsForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

async function prepareHostAndGuest(browser, testInfo) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'sub-host'));
  const guestName = normalizeQaNickname(makeQaName(testInfo, 'sub-guest'));
  const roomTitle = makeQaName(testInfo, 'sub-room');
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
  return { hostContext, guestContext, hostPage, guestPage, hostName, guestName, roomId };
}

async function getPlayerIdByNickname(roomId, nickname) {
  await expect.poll(async () => {
    const players = await getRoomPlayersForQa(roomId);
    return players.some((player) => player.nickname === nickname);
  }, { timeout: 10_000 }).toBe(true);
  const players = await getRoomPlayersForQa(roomId);
  const playerId = players.find((player) => player.nickname === nickname)?.id ?? '';
  expect(playerId, '게임을 나갈 게스트 player id가 필요합니다.').toBeTruthy();
  return playerId;
}

async function expectGuestSubstitutedByAi(qa, guestPlayerId) {
  await expect.poll(async () => {
    const players = await getRoomPlayersForQa(qa.roomId);
    const player = players.find((candidate) => candidate.id === guestPlayerId);
    return player ? {
      isAI: player.isAI === true,
      isSubstitutedByAI: player.isSubstitutedByAI === true,
      ready: player.ready === true,
    } : null;
  }, { timeout: 15_000 }).toEqual({ isAI: true, isSubstitutedByAI: true, ready: true });

  await expect.poll(async () => {
    const seats = await getRoomSeatsForQa(qa.roomId);
    const seat = seats.find((candidate) => candidate.originalPlayerId === guestPlayerId || candidate.currentPlayerId === guestPlayerId || candidate.playerId === guestPlayerId);
    return seat ? {
      aiActive: seat.aiActive === true,
      isSubstitutedByAI: seat.isSubstitutedByAI === true,
      status: seat.status,
    } : null;
  }, { timeout: 15_000 }).toEqual({ aiActive: true, isSubstitutedByAI: true, status: 'ai_substitute' });

  const substitutedCard = qa.hostPage.locator('.game-player-card.ai').filter({ hasText: qa.guestName }).first();
  await expect(substitutedCard).toBeVisible({ timeout: 15_000 });
  await expect(substitutedCard.locator('.game-player-status')).toHaveText('나감');
}

test.describe('player substitution AI QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('게임 중 나간 플레이어의 좌석은 AI 대체 상태로 유지된다', async ({ browser }, testInfo) => {
    const qa = await prepareHostAndGuest(browser, testInfo);
    roomId = qa.roomId;
    try {
      await runQaStep(testInfo, '사람 2명 게임 시작', async () => {
        await qa.hostPage.getByTestId('start-game-button').click();
        await expect(qa.hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(qa.guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
      });

      const guestPlayerId = await getPlayerIdByNickname(qa.roomId, qa.guestName);

      await runQaStep(testInfo, '게스트 게임 종료 후 AI 대체 확인', async () => {
        await qa.guestPage.getByTestId('game-end-button').click();
        const dialog = qa.guestPage.getByRole('dialog', { name: '게임 종료 확인' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: '게임 종료', exact: true }).click();
        await expect(qa.guestPage.getByTestId('game-screen')).toBeHidden({ timeout: 10_000 });
        await expectGuestSubstitutedByAi(qa, guestPlayerId);
      });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });

  test('참여 중이던 방 확인 팝업의 닫기를 누르면 게임 종료와 동일하게 AI가 대체한다', async ({ browser }, testInfo) => {
    const qa = await prepareHostAndGuest(browser, testInfo);
    roomId = qa.roomId;
    try {
      await runQaStep(testInfo, '복구할 게임과 게스트 좌석 준비', async () => {
        await qa.hostPage.getByTestId('start-game-button').click();
        await expect(qa.hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(qa.guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
      });

      const guestPlayerId = await getPlayerIdByNickname(qa.roomId, qa.guestName);

      await runQaStep(testInfo, '참여 중이던 방 확인 팝업에서 닫기', async () => {
        let releaseFirestore = () => undefined;
        const firestoreGate = new Promise((resolve) => { releaseFirestore = resolve; });
        const routeHandler = async (route) => {
          const url = route.request().url();
          if (url.includes('firestore.googleapis.com') || url.includes('google.firestore.v1.Firestore')) await firestoreGate;
          await route.continue().catch(() => undefined);
        };
        await qa.guestPage.route('**/*', routeHandler);
        try {
          await qa.guestPage.reload({ waitUntil: 'domcontentloaded' });
          const recoveryModal = qa.guestPage.getByRole('dialog', { name: '참여 중이던 방을 확인하고 있습니다...' });
          const closeButton = qa.guestPage.getByTestId('stored-room-recovery-close');
          await expect(recoveryModal).toBeVisible({ timeout: 10_000 });
          await expect(closeButton).toBeVisible();
          await expect(closeButton).toHaveText('닫기');

          const layout = await recoveryModal.evaluate((modal) => {
            const close = modal.querySelector('[data-testid="stored-room-recovery-close"]');
            if (!(close instanceof HTMLElement)) throw new Error('복구 팝업 닫기 버튼을 찾지 못했습니다.');
            const modalRect = modal.getBoundingClientRect();
            const closeRect = close.getBoundingClientRect();
            return {
              modalRight: modalRect.right,
              modalTop: modalRect.top,
              closeRight: closeRect.right,
              closeTop: closeRect.top,
              closeWidth: closeRect.width,
              closeHeight: closeRect.height,
            };
          });
          expect(layout.modalRight - layout.closeRight).toBeGreaterThanOrEqual(8);
          expect(layout.closeTop - layout.modalTop).toBeGreaterThanOrEqual(8);
          expect(layout.closeWidth).toBeLessThanOrEqual(80);
          expect(layout.closeHeight).toBeLessThanOrEqual(44);

          const navigation = qa.guestPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 });
          await closeButton.evaluate((button) => button.click());
          releaseFirestore();
          await navigation;
        } finally {
          releaseFirestore();
          await qa.guestPage.unroute('**/*', routeHandler);
        }

        await expect(qa.guestPage.getByTestId('create-room-button')).toBeVisible({ timeout: 15_000 });
        await expect(qa.guestPage.getByTestId('game-screen')).toBeHidden();
        await expectGuestSubstitutedByAi(qa, guestPlayerId);
      });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });
});
