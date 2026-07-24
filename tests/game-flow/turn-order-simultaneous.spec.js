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

const installAudioMock = async (context) => {
  await context.addInitScript(() => {
    window.__YUT_QA_AUDIO_EVENTS__ = [];

    class MockAudio extends EventTarget {
      constructor(source = '') {
        super();
        this.src = String(source);
        this.currentTime = 0;
        this.volume = 1;
        this.muted = false;
        this.preload = '';
        this.paused = true;
      }

      load() {}

      pause() {
        this.paused = true;
        window.__YUT_QA_AUDIO_EVENTS__.push({ type: 'pause', src: this.src, muted: this.muted });
      }

      play() {
        this.paused = false;
        window.__YUT_QA_AUDIO_EVENTS__.push({ type: 'play', src: this.src, muted: this.muted });
        return Promise.resolve();
      }
    }

    Object.defineProperty(window, 'Audio', {
      configurable: true,
      writable: true,
      value: MockAudio,
    });
  });
};

const countUnmutedAudioPlayEvents = (page, assetName) => page.evaluate((expectedAssetName) => {
  const matchesAsset = (source) => {
    const filename = decodeURIComponent(String(source).split('/').pop()?.split('?')[0] ?? '');
    return new RegExp(`^${expectedAssetName}(?:-[^.]+)?\\.wav$`).test(filename);
  };
  return window.__YUT_QA_AUDIO_EVENTS__.filter((event) => event.type === 'play' && !event.muted && matchesAsset(event.src)).length;
}, assetName);

async function prepareTurnOrderRoom(browser, testInfo) {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await Promise.all([installAudioMock(hostContext), installAudioMock(guestContext)]);
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'to-host'));
  const guestName = normalizeQaNickname(makeQaName(testInfo, 'to-guest'));
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
        await expect(qa.hostPage.locator('.turn-order-timing-track')).toHaveCount(0);
        await expect(qa.hostPage.locator('.roll-timing-meter')).toBeVisible();
        await expect(qa.hostPage.locator('.roll-timing-orb')).toBeVisible();
        await expect(hostButton).toHaveClass(/roll-button/);
        await Promise.all([hostButton.click(), guestButton.click()]);

        await expect(qa.hostPage.getByTestId('turn-order-own-result')).toContainText('도');
        await expect(qa.guestPage.getByTestId('turn-order-own-result')).toContainText('도');
        await expect.poll(() => countUnmutedAudioPlayEvents(qa.hostPage, 'do'), {
          timeout: 5_000,
          message: '호스트 순서 정하기 도 결과 공개 시 do.wav가 한 번 재생되어야 합니다.',
        }).toBe(1);
        await expect.poll(() => countUnmutedAudioPlayEvents(qa.guestPage, 'do'), {
          timeout: 5_000,
          message: '게스트 순서 정하기 도 결과 공개 시 do.wav가 한 번 재생되어야 합니다.',
        }).toBe(1);
        const hostOtherCard = qa.hostPage.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: qa.guestName });
        const guestOtherCard = qa.guestPage.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: qa.hostName });
        await expect(hostOtherCard).not.toContainText(/도|개|걸|윷|모|빽도|낙/);
        await expect(guestOtherCard).not.toContainText(/도|개|걸|윷|모|빽도|낙/);

        await expect.poll(async () => (await readTurnOrderRound(qa.roomId))?.status ?? '', { timeout: 12_000 }).toBe('reveal-pending');
        const round = await readTurnOrderRound(qa.roomId);
        expect(Number(round?.aggregatedAt ?? 0)).toBeLessThan(Number(round?.deadlineAt ?? 0));
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
        await expect(qa.hostPage.locator('.roll-timing-meter')).toBeVisible();
        const firstOrbAnimationName = await qa.hostPage.locator('.roll-timing-orb').evaluate((element) => getComputedStyle(element).animationName);
        expect(firstOrbAnimationName).toContain('roll-timing-orb');
        await Promise.all([hostButton.click(), guestButton.click()]);
        await expect(qa.hostPage.getByTestId('turn-order-own-result')).toContainText('걸');
        await expect(qa.guestPage.getByTestId('turn-order-own-result')).toContainText('개');
        await expect.poll(() => countUnmutedAudioPlayEvents(qa.hostPage, 'geol'), {
          timeout: 5_000,
          message: '호스트 순서 정하기 걸 결과 공개 시 geol.wav가 한 번 재생되어야 합니다.',
        }).toBe(1);
        await expect.poll(() => countUnmutedAudioPlayEvents(qa.guestPage, 'gae'), {
          timeout: 5_000,
          message: '게스트 순서 정하기 개 결과 공개 시 gae.wav가 한 번 재생되어야 합니다.',
        }).toBe(1);

        await expect.poll(async () => (await readTurnOrderRound(qa.roomId))?.status ?? '', { timeout: 8_000 }).toBe('reveal-pending');
        const rematchRound = await readTurnOrderRound(qa.roomId);
        expect(rematchRound?.index).toBe(2);
        expect(Number(rematchRound?.aggregatedAt ?? 0)).toBeLessThan(Number(rematchRound?.deadlineAt ?? 0));
        expect(Number(rematchRound?.revealAt ?? 0) - Number(rematchRound?.aggregatedAt ?? 0)).toBe(3_000);

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

  test('AI는 동률 재대결 라운드가 시작되면 즉시 자동 제출되어 던지는 중에 머물지 않는다', async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'ai-host'));
    const roomTitle = makeQaName(testInfo, 'ai-tie-room');
    await primeLobbyStorage(hostContext, {
      nickname: hostName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await hostContext.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['도', '걸'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도', '개'];
    });
    const hostPage = await hostContext.newPage();

    try {
      await createRoomFromLobby(hostPage, roomTitle);
      roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);
      await hostPage.getByTestId('add-ai-P2').click();
      await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await hostPage.getByTestId('start-game-button').click();
      await expect(hostPage.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

      const readAiEntry = async () => {
        const state = await getRoomStateForQa(roomId);
        return state?.turnOrderIntro?.order?.find((entry) => entry.isAI) ?? null;
      };
      await expect.poll(async () => Boolean(await readAiEntry()), { timeout: 5_000 }).toBe(true);
      const aiEntry = await readAiEntry();
      expect(aiEntry).not.toBeNull();
      const aiSeatId = aiEntry?.seatId ?? '';
      const aiCard = hostPage.getByTestId('turn-order-result-grid').locator('.turn-order-result-card').filter({ hasText: aiEntry?.name ?? 'AI' });

      await runQaStep(testInfo, '첫 라운드 AI 즉시 자동 제출과 동률 공개', async () => {
        const hostButton = hostPage.getByTestId('turn-order-roll-button');
        await expect(hostButton).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => {
          const round = await readTurnOrderRound(roomId);
          const submission = round?.submissions?.find((entry) => entry.seatId === aiSeatId);
          return submission ? `${submission.source}:${submission.resultName}` : '';
        }, { timeout: 5_000 }).toBe('auto:도');
        await expect(aiCard).toContainText('결과 대기');
        await expect(aiCard).not.toContainText('던지는 중');

        await hostButton.click();
        await expect(hostPage.getByTestId('turn-order-own-result')).toContainText('도');
        await expect.poll(async () => (await readTurnOrderRound(roomId))?.status ?? '', { timeout: 8_000 }).toBe('reveal-pending');
        const round = await readTurnOrderRound(roomId);
        expect(Number(round?.aggregatedAt ?? 0)).toBeLessThan(Number(round?.deadlineAt ?? 0));
        expect(Number(round?.revealAt ?? 0) - Number(round?.aggregatedAt ?? 0)).toBe(3_000);
        await expect(aiCard).toContainText('도', { timeout: 6_000 });
        await expect(hostPage.getByTestId('turn-order-tie-notice')).toBeVisible();
      });

      await runQaStep(testInfo, '재대결 라운드 AI 즉시 자동 제출', async () => {
        const hostButton = hostPage.getByTestId('turn-order-roll-button');
        await expect(hostButton).toBeVisible({ timeout: 10_000 });
        await expect.poll(async () => {
          const round = await readTurnOrderRound(roomId);
          if (round?.index !== 2) return '';
          const submission = round.submissions?.find((entry) => entry.seatId === aiSeatId);
          return submission ? `${submission.source}:${submission.resultName}` : '';
        }, { timeout: 5_000 }).toBe('auto:개');
        await expect(aiCard).toContainText('결과 대기');
        await expect(aiCard).not.toContainText('던지는 중');

        await hostButton.click();
        await expect(hostPage.getByTestId('turn-order-own-result')).toContainText('걸');
        await expect.poll(async () => (await readTurnOrderRound(roomId))?.status ?? '', { timeout: 8_000 }).toBe('reveal-pending');
        const rematchRound = await readTurnOrderRound(roomId);
        expect(rematchRound?.index).toBe(2);
        expect(Number(rematchRound?.aggregatedAt ?? 0)).toBeLessThan(Number(rematchRound?.deadlineAt ?? 0));
        expect(Number(rematchRound?.revealAt ?? 0) - Number(rematchRound?.aggregatedAt ?? 0)).toBe(3_000);
        await expect(hostPage.getByTestId('turn-order-final-order')).toBeVisible({ timeout: 15_000 });
      });
    } finally {
      await hostContext.close();
    }
  });
});
