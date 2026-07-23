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
  getRoomForQa,
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

async function prepareTurnOrderRoom(browser, testInfo) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'turn-order-host'));
  const guestName = normalizeQaNickname(makeQaName(testInfo, 'turn-order-guest'));
  const roomTitle = makeQaName(testInfo, 'turn-order-room');

  await primeLobbyStorage(hostContext, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await primeLobbyStorage(guestContext, {
    nickname: guestName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await hostContext.addInitScript(() => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['도', '걸'];
  });
  await guestContext.addInitScript(() => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['도', '개'];
  });

  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  await createRoomFromLobby(hostPage, roomTitle);
  const roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
  await joinRoomFromLobby(guestPage, roomTitle);
  await markGuestReady(guestPage);
  await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });

  return { hostContext, guestContext, hostPage, guestPage, hostName, guestName, roomId };
}

const readTurnOrderRound = async (roomId) => {
  const state = await getRoomStateForQa(roomId);
  return state?.turnOrderIntro?.currentRound ?? null;
};

test.describe('simultaneous turn-order QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('동시 입력, revealAt 공개, 동률 재대결과 최종 순서를 모든 클라이언트에 동일하게 적용한다', async ({ browser }, testInfo) => {
    const qa = await prepareTurnOrderRoom(browser, testInfo);
    roomId = qa.roomId;

    try {
      await runQaStep(testInfo, '게임 시작 요청 8초 뒤 첫 라운드 준비', async () => {
        await qa.hostPage.getByTestId('start-game-button').click();
        await expect(qa.hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(qa.guestPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect(qa.hostPage.getByTestId('turn-order-preparing')).toBeVisible({ timeout: 5_000 });
        await expect(qa.guestPage.getByTestId('turn-order-preparing')).toBeVisible({ timeout: 5_000 });

        await expect.poll(async () => {
          const [room, state] = await Promise.all([getRoomForQa(qa.roomId), getRoomStateForQa(qa.roomId)]);
          return Number(state?.turnOrderIntro?.currentRound?.startAt ?? 0) - Number(room?.startRequestedAt ?? 0);
        }, { timeout: 5_000 }).toBeGreaterThanOrEqual(7_900);
        const [room, state] = await Promise.all([getRoomForQa(qa.roomId), getRoomStateForQa(qa.roomId)]);
        const delayMs = Number(state?.turnOrderIntro?.currentRound?.startAt ?? 0) - Number(room?.startRequestedAt ?? 0);
        expect(delayMs).toBeLessThanOrEqual(8_100);
        expect(state?.turnOrderIds ?? []).toEqual([]);
        expect(Number(state?.turnDeadlineAt ?? 0)).toBe(0);
      });

      await runQaStep(testInfo, '첫 라운드 자기 결과 즉시 표시와 타인 결과 비공개', async () => {
        const hostButton = qa.hostPage.getByTestId('turn-order-roll-button');
        const guestButton = qa.guestPage.getByTestId('turn-order-roll-button');
        await expect(hostButton).toBeVisible({ timeout: 10_000 });
        await expect(guestButton).toBeVisible({ timeout: 10_000 });
        await Promise.all([hostButton.click(), guestButton.click()]);

        await expect(qa.hostPage.getByTestId('turn-order-own-result')).toContainText('도');
        await expect(qa.guestPage.getByTestId('turn-order-own-result')).toContainText('도');
        const hostOtherCard = qa.hostPage.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: qa.guestName });
        const guestOtherCard = qa.guestPage.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: qa.hostName });
        await expect(hostOtherCard).not.toContainText(/도|개|걸|윷|모|빽도|낙/);
        await expect(guestOtherCard).not.toContainText(/도|개|걸|윷|모|빽도|낙/);

        await expect.poll(async () => (await readTurnOrderRound(qa.roomId))?.status ?? '', { timeout: 12_000 }).toBe('reveal-pending');
        const round = await readTurnOrderRound(qa.roomId);
        expect(Number(round?.revealAt ?? 0) - Number(round?.aggregatedAt ?? 0)).toBe(3_000);
        await expect(hostOtherCard).toContainText('도', { timeout: 6_000 });
        await expect(guestOtherCard).toContainText('도', { timeout: 6_000 });
        await expect(qa.hostPage.getByTestId('turn-order-tie-notice')).toBeVisible();
      });

      await runQaStep(testInfo, '동률 참가자 재대결 후 최종 순서 3초 표시', async () => {
        const hostButton = qa.hostPage.getByTestId('turn-order-roll-button');
        const guestButton = qa.guestPage.getByTestId('turn-order-roll-button');
        await expect(hostButton).toBeVisible({ timeout: 10_000 });
        await expect(guestButton).toBeVisible({ timeout: 10_000 });
        await Promise.all([hostButton.click(), guestButton.click()]);
        await expect(qa.hostPage.getByTestId('turn-order-own-result')).toContainText('걸');
        await expect(qa.guestPage.getByTestId('turn-order-own-result')).toContainText('개');

        await expect(qa.hostPage.getByTestId('turn-order-final-order')).toBeVisible({ timeout: 15_000 });
        await expect(qa.guestPage.getByTestId('turn-order-final-order')).toBeVisible({ timeout: 15_000 });
        const finalState = await getRoomStateForQa(qa.roomId);
        expect(finalState?.turnOrderIds).toEqual([
          finalState?.gameSeats?.[0]?.id,
          finalState?.gameSeats?.[1]?.id,
        ]);
        expect(Number(finalState?.gameStartAt ?? finalState?.turnOrderIntro?.gameStartAt ?? 0)).toBeGreaterThan(0);
        expect(Number(finalState?.turnOrderIntro?.gameStartAt ?? 0) - Number(finalState?.turnOrderIntro?.finalOrderAt ?? 0)).toBe(3_000);

        await expect(qa.hostPage.getByTestId('turn-order-overlay')).toBeHidden({ timeout: 6_000 });
        await expect(qa.guestPage.getByTestId('turn-order-overlay')).toBeHidden({ timeout: 6_000 });
        const startedState = await getRoomStateForQa(qa.roomId);
        expect(startedState?.turnOrderIds).toEqual(startedState?.initialTurnOrderIds);
        expect(Number(startedState?.gameStartedAt ?? 0)).toBeGreaterThan(0);
        expect(Number(startedState?.turnDeadlineAt ?? 0)).toBeGreaterThan(Number(startedState?.gameStartedAt ?? 0));
      });
    } finally {
      await qa.guestContext.close();
      await qa.hostContext.close();
    }
  });
});
