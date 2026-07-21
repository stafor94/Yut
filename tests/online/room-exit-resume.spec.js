import { test, expect } from '@playwright/test';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomForQa, getRoomPlayersForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';
import { collectScreenState, createRoomFromLobby, joinRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';

test.describe('in-game exit and resume QA', () => {
  test('게임을 나가면 참가 인원을 줄이고 새 방 생성 후 기존 좌석으로 복귀한다', async ({ page, context }, testInfo) => {
    test.slow();
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);

    const nickname = normalizeQaNickname(makeQaName(testInfo, 'exit-resume-host'));
    const oldRoomTitle = makeQaName(testInfo, 'exit-resume-old');
    const newRoomTitle = makeQaName(testInfo, 'exit-resume-new');
    let oldRoomId;
    let newRoomId;

    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    page.on('dialog', (dialog) => { void dialog.accept(); });

    await runQaStep(testInfo, '인게임 퇴장 후 참가 인원·새 방 생성·기존 좌석 복귀 확인', async () => {
      try {
        await createRoomFromLobby(page, oldRoomTitle);
        oldRoomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(oldRoomTitle);
        expect(oldRoomId, '기존 QA 방 ID가 필요합니다.').toBeTruthy();

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

        await page.getByTestId('game-end-button').click();
        const endDialog = page.getByRole('dialog', { name: '게임 종료 확인' });
        await expect(endDialog).toBeVisible();
        await endDialog.getByRole('button', { name: '게임 종료', exact: true }).click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });

        await expect.poll(async () => Number((await getRoomForQa(oldRoomId))?.currentPlayers ?? -1), {
          timeout: 15_000,
          message: '인게임 퇴장 뒤 기존 방의 연결된 참가 인원은 0명이어야 합니다.',
        }).toBe(0);
        await expect.poll(async () => {
          const players = await getRoomPlayersForQa(oldRoomId);
          const host = players.find((player) => player.id && player.nickname === nickname);
          return { isAI: Boolean(host?.isAI), isSubstitutedByAI: Boolean(host?.isSubstitutedByAI), seatIndex: Number(host?.seatIndex ?? -1) };
        }, { timeout: 15_000 }).toEqual({ isAI: true, isSubstitutedByAI: true, seatIndex: 0 });

        await createRoomFromLobby(page, newRoomTitle);
        newRoomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(newRoomTitle);
        expect(newRoomId, '새 QA 방 ID가 필요합니다.').toBeTruthy();
        expect(newRoomId).not.toBe(oldRoomId);
        expect(await findRoomIdByTitle(oldRoomTitle), '기존 진행 방은 복귀를 위해 유지되어야 합니다.').toBe(oldRoomId);

        await page.getByRole('button', { name: '방 나가기', exact: true }).click();
        await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 25_000 });

        await joinRoomFromLobby(page, oldRoomTitle);
        await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
        await expect.poll(async () => Number((await getRoomForQa(oldRoomId))?.currentPlayers ?? -1), {
          timeout: 15_000,
          message: '기존 방 복귀 뒤 연결된 참가 인원은 다시 1명이어야 합니다.',
        }).toBe(1);
        await expect.poll(async () => {
          const players = await getRoomPlayersForQa(oldRoomId);
          const host = players.find((player) => player.id && player.nickname === nickname);
          return { isAI: Boolean(host?.isAI), isSubstitutedByAI: Boolean(host?.isSubstitutedByAI), seatIndex: Number(host?.seatIndex ?? -1) };
        }, { timeout: 15_000 }).toEqual({ isAI: false, isSubstitutedByAI: false, seatIndex: 0 });
      } finally {
        if (newRoomId) await deleteRoomForQa(newRoomId).catch(() => undefined);
        if (oldRoomId) await deleteRoomForQa(oldRoomId).catch(() => undefined);
      }
    });
  });
});
