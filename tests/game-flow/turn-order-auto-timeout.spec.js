import { test, expect } from '@playwright/test';
import { createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import {
  deleteRoomForQa,
  findRoomIdByTitle,
  getRoomStateForQa,
  getRoomTurnOrderSubmissionsForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

test.describe('turn-order automatic timeout QA', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId);
    roomId = '';
  });

  test('사람 플레이어가 5초 동안 입력하지 않으면 로컬에서 한 번 자동 던지고 게임을 시작한다', async ({ page, context }, testInfo) => {
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'auto-timeout-host'));
    const roomTitle = makeQaName(testInfo, 'turn-order-auto-timeout-room');
    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '4',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    });

    await createRoomFromLobby(page, roomTitle);
    roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
    await page.getByTestId('add-ai-P2').click();
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('start-game-button').click();
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });

    await runQaStep(testInfo, '첫 라운드 5초 authoritative deadline 확인', async () => {
      await expect(page.getByTestId('turn-order-roll-button')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('turn-order-round-timer')).toBeVisible();
      const state = await getRoomStateForQa(roomId);
      const round = state?.turnOrderIntro?.currentRound;
      expect(round?.index).toBe(1);
      expect(Number(round?.deadlineAt ?? 0) - Number(round?.startAt ?? 0)).toBe(5_000);
    });

    await runQaStep(testInfo, '5초 미입력 시 로컬 자동 제출과 단일 결과 생성', async () => {
      const state = await getRoomStateForQa(roomId);
      const intro = state?.turnOrderIntro;
      const round = intro?.currentRound;
      const localEntry = intro?.order?.find((entry) => !entry.isAI);
      expect(round).toBeTruthy();
      expect(localEntry).toBeTruthy();
      const deadlineAt = Number(round?.deadlineAt ?? 0);
      const roundId = round?.id ?? '';
      const localSeatId = localEntry?.seatId ?? '';

      await expect.poll(async () => {
        const submissions = (await getRoomTurnOrderSubmissionsForQa(roomId))
          .filter((submission) => submission.roundId === roundId && submission.seatId === localSeatId);
        if (submissions.length !== 1) return null;
        const [submission] = submissions;
        return {
          source: submission.source,
          resultName: submission.resultName,
          afterDeadline: Number(submission.submittedAt ?? 0) >= deadlineAt,
          beforeFallback: Number(submission.submittedAt ?? 0) < deadlineAt + 500,
        };
      }, {
        timeout: 8_000,
        message: '활성 클라이언트는 5초 deadline 직후 coordinator fallback 전에 한 번 자동 제출해야 합니다.',
      }).toEqual({
        source: 'auto',
        resultName: '모',
        afterDeadline: true,
        beforeFallback: true,
      });

      await expect(page.getByTestId('turn-order-own-result')).toContainText('모');
      await expect(page.getByTestId('turn-order-roll-button')).toHaveCount(0);
    });

    await runQaStep(testInfo, '자동 제출 집계 후 최종 순서와 일반 게임 진입', async () => {
      await expect.poll(async () => {
        const state = await getRoomStateForQa(roomId);
        return state?.turnOrderIntro?.currentRound?.status ?? '';
      }, { timeout: 8_000 }).toBe('reveal-pending');

      const aggregatedState = await getRoomStateForQa(roomId);
      const round = aggregatedState?.turnOrderIntro?.currentRound;
      const submissions = (await getRoomTurnOrderSubmissionsForQa(roomId))
        .filter((submission) => submission.roundId === round?.id);
      expect(submissions).toHaveLength(2);
      expect(new Set(submissions.map((submission) => submission.seatId)).size).toBe(2);
      expect(submissions.every((submission) => submission.source === 'auto')).toBe(true);

      await expect(page.getByTestId('turn-order-final-order')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('turn-order-overlay')).toBeHidden({ timeout: 7_000 });
      await expect(page.getByTestId('play-controls')).toBeVisible({ timeout: 5_000 });
    });
  });
});
