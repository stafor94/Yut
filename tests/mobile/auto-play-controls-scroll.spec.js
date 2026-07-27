import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { hasFirebaseConfig, makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomPlayersForQa, getRoomStateForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';
import { patchRoomStateFromPage } from '../helpers/room-state-patch.js';

const directControlSelector = [
  '.time-limit-bar',
  '.roll-timing-meter',
  '[data-testid="roll-yut-button"]',
  '[data-testid="move-piece-button"]',
  '.inline-item-prompt',
  '.bottom-branch-controls',
].join(', ');

test.describe('mobile auto-play control surface QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('자동 플레이 상태는 스크롤과 무관하게 play-controls 안에서 표시되고 사람 제어로 복귀한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', '412×915 mobile-galaxy project에서만 실행합니다.');
    expect(await hasFirebaseConfig(), 'Firebase 설정이 없어 온라인 QA를 실행할 수 없습니다.').toBe(true);
    expect(page.viewportSize()).toEqual({ width: 412, height: 915 });

    const hostName = normalizeQaNickname(makeQaName(testInfo, 'auto-host'));
    const roomTitle = makeQaName(testInfo, 'auto-scroll-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', stackedRollMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 45_000;
    });

    let hostPlayer;
    let normalControlsHeight = 0;

    await runQaStep(testInfo, 'AI 게임 시작 후 로컬 윷 조작 영역 준비', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      expect(roomId, '생성된 QA 방 ID가 필요합니다.').toBeTruthy();
      await page.getByTestId('add-ai-P2').click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => {
        const debug = (await collectScreenState(page)).yutDebug ?? {};
        return Array.isArray(debug.turnOrderIds)
          && debug.turnOrderIds.length === 2
          && !debug.turnOrderPhase?.active
          && !debug.turnOrderIntro
          && debug.activeSeat?.id === debug.localSeatId;
      }, { timeout: 40_000, message: '로컬 플레이어 첫 턴이 준비되어야 합니다.' }).toBe(true);
      const players = await getRoomPlayersForQa(roomId);
      hostPlayer = players.find((player) => !player.isAI && player.nickname === hostName) ?? players.find((player) => !player.isAI);
      expect(hostPlayer?.id, '로컬 player ID가 필요합니다.').toBeTruthy();
      await expect(page.getByTestId('roll-yut-button')).toBeVisible({ timeout: 15_000 });
      normalControlsHeight = await page.locator('.play-controls').evaluate((element) => element.getBoundingClientRect().height);
    });

    await runQaStep(testInfo, 'authoritative 자동 플레이 상태를 주입하고 조작 영역 교체 확인', async () => {
      const state = await getRoomStateForQa(roomId);
      expect(state, '현재 game state가 필요합니다.').toBeTruthy();
      const hostTurnIndex = (Array.isArray(state.turnOrderIds) ? state.turnOrderIds : []).indexOf(hostPlayer.id);
      expect(hostTurnIndex).toBeGreaterThanOrEqual(0);
      await patchRoomStateFromPage(page, roomId, {
        turnIndex: hostTurnIndex,
        roll: null,
        rollStack: [],
        selectedRollStackIndex: null,
        rollStackClosed: false,
        pendingAfterMoveTurnIndex: null,
        pendingGoldenYutSelection: null,
        pendingTrapPlacement: null,
        waitingForPlayersReady: false,
        turnActionTimeoutCountBySeatId: { ...(state.turnActionTimeoutCountBySeatId ?? {}), [hostPlayer.id]: 2 },
        autoPlayBySeatId: { ...(state.autoPlayBySeatId ?? {}), [hostPlayer.id]: true },
        turnDeadlineAt: Date.now() + 60_000,
        turnDeadlineKind: 'roll',
        turnVersion: Number(state.turnVersion ?? 0) + 1,
      });
      await expect(page.getByTestId('auto-play-control-panel')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(`${hostName}님의 행동을 어려움 AI가 대신 판단합니다.`)).toBeVisible();
      await expect(page.getByTestId('resume-human-control-button')).toBeVisible();
      await expect(page.locator('[data-testid="auto-play-overlay"]')).toHaveCount(0);
      await expect(page.locator('.play-controls').locator(directControlSelector)).toHaveCount(0);

      const geometry = await page.getByTestId('auto-play-control-panel').evaluate((panel) => {
        const controls = panel.closest('.play-controls');
        if (!(controls instanceof HTMLElement)) throw new Error('자동 플레이 패널의 play-controls 부모를 찾지 못했습니다.');
        const panelRect = panel.getBoundingClientRect();
        const controlsRect = controls.getBoundingClientRect();
        return {
          parentAutoMode: controls.classList.contains('auto-play-mode'),
          panelTop: panelRect.top,
          panelBottom: panelRect.bottom,
          controlsTop: controlsRect.top,
          controlsBottom: controlsRect.bottom,
          controlsHeight: controlsRect.height,
        };
      });
      expect(geometry.parentAutoMode).toBe(true);
      expect(geometry.panelTop).toBeGreaterThanOrEqual(geometry.controlsTop - 1);
      expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.controlsBottom + 1);
      expect(Math.abs(geometry.controlsHeight - normalControlsHeight)).toBeLessThanOrEqual(28);
    });

    await runQaStep(testInfo, '페이지 스크롤 후에도 패널이 같은 조작 영역에 유지됨', async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.getByTestId('auto-play-control-panel').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('auto-play-control-panel')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId('auto-play-control-panel').scrollIntoViewIfNeeded();
      expect(await page.getByTestId('auto-play-control-panel').evaluate((panel) => panel.closest('.play-controls')?.contains(panel) === true)).toBe(true);
    });

    await runQaStep(testInfo, '통제권 회수 pending과 일반 조작 UI 복구 확인', async () => {
      await page.evaluate(() => {
        const observation = { pendingTextSeen: false, disabledSeen: false };
        const inspect = () => {
          const button = document.querySelector('[data-testid="resume-human-control-button"]');
          if (!(button instanceof HTMLButtonElement)) return;
          if (button.textContent?.includes('통제권 가져오는 중...')) observation.pendingTextSeen = true;
          if (button.disabled) observation.disabledSeen = true;
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
        inspect();
        window.__YUT_QA_AUTO_PLAY_RESUME_OBSERVATION__ = observation;
        window.__YUT_QA_STOP_AUTO_PLAY_RESUME_OBSERVATION__ = () => observer.disconnect();
      });
      await page.getByTestId('resume-human-control-button').click();
      await expect.poll(async () => (await getRoomStateForQa(roomId))?.autoPlayBySeatId?.[hostPlayer.id] === true, {
        timeout: 20_000,
        message: 'authoritative 통제권 회수가 완료되어야 합니다.',
      }).toBe(false);
      const observation = await page.evaluate(() => {
        window.__YUT_QA_STOP_AUTO_PLAY_RESUME_OBSERVATION__?.();
        return window.__YUT_QA_AUTO_PLAY_RESUME_OBSERVATION__;
      });
      expect(observation?.pendingTextSeen).toBe(true);
      expect(observation?.disabledSeen).toBe(true);
      await expect(page.getByTestId('auto-play-control-panel')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('roll-yut-button')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.roll-timing-meter')).toBeVisible();
      await expect(page.locator('.time-limit-bar')).toBeVisible();
    });
  });
});
