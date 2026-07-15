import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('BUG_HISTORY regression smoke', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('게임 시작 직후 윷 던지기/대기 버튼 상태가 고착되지 않는다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'reg-host'));
    const roomTitle = makeQaName(testInfo, 'reg-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, 'AI 게임 시작', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '턴 컨트롤 상태 진단', async () => {
      const state = await collectScreenState(page);
      expect(
        state.rollButton.visible || state.moveButton.visible || state.turnWaitingButton.visible,
        `턴 컨트롤이 없는 상태입니다: ${JSON.stringify(state, null, 2)}`,
      ).toBe(true);
    });
  });

  test('timeout 벌칙은 오프라인 로컬 timeout에만 적용된다', async () => {
    const appSource = readFileSync('src/app/App.tsx', 'utf8');

    expect(appSource).toContain('const PENALTY_TURN_ACTION_TIMEOUT_MS = 10000;');
    expect(appSource).toContain('const getTurnActionTimeoutMs = (seatId = activeSeat?.id ?? \'\') => activeRoomId ? TURN_ACTION_TIMEOUT_MS');
    expect(appSource).toContain('const getItemPromptTimeoutMs = (seatId = localSeatId) => activeRoomId ? ITEM_PROMPT_TIMEOUT_MS');
    expect(appSource).toContain('if (!seatId || activeRoomId) return;');

    const onlineItemPromptEffect = appSource.slice(
      appSource.indexOf('if (activeRoomId) {', appSource.indexOf('if (!itemPromptTiming) return undefined;')),
      appSource.indexOf('const timeoutMs = getItemPromptTimeoutMs(localSeatId);'),
    );
    expect(onlineItemPromptEffect).not.toContain('markTurnActionTimedOut');

    const skipItemPromptHandler = appSource.slice(
      appSource.indexOf('onSkipItemPrompt={() => {'),
      appSource.indexOf('onUseItem={useItem}'),
    );
    expect(skipItemPromptHandler.indexOf('if (activeRoomId)')).toBeLessThan(skipItemPromptHandler.indexOf('clearTurnActionTimeoutPenalty(localSeatId);'));
  });

});
