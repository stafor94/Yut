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

  test('온라인 윷 던지기는 sequence replay 애니메이션을 표시하고 이동 직후 경로 preview를 숨긴다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'seq-host'));
    const roomTitle = makeQaName(testInfo, 'seq-room');
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
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '내 차례 윷 던지기 animation 확인', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '온라인 sequence replay를 확인할 수 있는 내 차례 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');

      await page.getByTestId('roll-yut-button').click();
      await expect(page.locator('.roll-stage.pending-roll'), `클릭 직후 서버 확정 전 pending 윷 애니메이션이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 500 });
      await expect(page.locator('.roll-stage.pending-roll .roll-label'), 'pending 단계에서는 결과명을 추측할 수 있는 label을 숨겨야 합니다.').toHaveCount(0);
      await expect(page.locator('.roll-stage.resolved-roll .roll-label'), `서버 authoritative 윷 결과 label이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('.roll-stage.resolved-roll .roll-label'), 'authoritative 결과 label은 한 번만 표시되어야 합니다.').toHaveCount(1);
    });

    await runQaStep(testInfo, '말 이동 직후 preview 제거 확인', async () => {
      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.moveButton.visible && !state.moveButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 20_000, message: '윷 결과 적용 후 선택한 말 이동 버튼이 활성화되어야 합니다.' }).toBe('ready');

      await page.getByTestId('move-piece-button').click();
      await expect.poll(async () => page.locator('.board-node.route-preview').count(), {
        timeout: 2_000,
        message: '로컬 이동 애니메이션 종료 후 서버 확정 대기 중에는 예상 이동 경로가 없어야 합니다.',
      }).toBe(0);
    });
  });

  test('host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'ai-seq-host'));
    const roomTitle = makeQaName(testInfo, 'ai-seq-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    const getMovingPieces = () => page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const pieces = Array.isArray(debug.pieces) ? debug.pieces : [];
      const localSeatId = String(debug.localSeatId ?? '');
      return Array.from(document.querySelectorAll('[data-testid^="piece-"]'))
        .map((node) => {
          const testId = node.getAttribute('data-testid') ?? '';
          const pieceId = testId.replace(/^piece-/, '');
          const debugPiece = pieces.find((piece) => piece && typeof piece === 'object' && piece.id === pieceId) ?? {};
          const rect = node.getBoundingClientRect();
          return {
            testId,
            ownerId: String(debugPiece.ownerId ?? ''),
            isLocalOwner: Boolean(localSeatId && debugPiece.ownerId === localSeatId),
            className: node.getAttribute('class') ?? '',
            left: Math.round(rect.left),
            top: Math.round(rect.top),
          };
        })
        .filter((piece) => piece.className.includes('moving'));
    });

    await runQaStep(testInfo, 'host+AI 온라인 게임 시작', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '본인 이동은 optimistic 애니메이션 후 sequence에서 재재생되지 않음', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '본인 이동 검증을 위해 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');
      await page.getByTestId('roll-yut-button').click();
      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.moveButton.visible && !state.moveButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 20_000, message: '본인 말 이동 버튼이 활성화되어야 합니다.' }).toBe('ready');
      await page.getByTestId('move-piece-button').click();
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 8_000, message: '본인 optimistic 이동 애니메이션이 시작되어야 합니다.' }).toBeGreaterThan(0);
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 12_000, message: '본인 optimistic 이동 애니메이션이 종료되어야 합니다.' }).toBe(0);
      await page.waitForTimeout(1_200);
      expect(await getMovingPieces(), '서버 sequence 확정 후 본인 말 이동이 다시 재생되면 안 됩니다.').toEqual([]);
    });

    await runQaStep(testInfo, 'AI 대리 제출 이동은 중간 노드를 거쳐 재생됨', async () => {
      const observedPositions = new Set();
      await expect.poll(async () => {
        const moving = await getMovingPieces();
        for (const piece of moving) {
          if (!piece.isLocalOwner) observedPositions.add(`${piece.testId}:${piece.left},${piece.top}`);
        }
        if (observedPositions.size >= 2) return 'animated';
        const state = await collectScreenState(page);
        return `positions=${Array.from(observedPositions).join('|')} state=${JSON.stringify(state.yutDebug ?? {}, null, 2)}`;
      }, { timeout: 70_000, intervals: [100, 150, 200, 250], message: 'AI 이동이 최종 위치 순간이동이 아니라 최소 2개 칸 위치를 거쳐야 합니다.' }).toBe('animated');
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
