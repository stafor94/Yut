import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

async function addAiAndWaitUntilGameCanStart(page) {
  const addAiButton = page.getByTestId('add-ai-P2');
  await expect(addAiButton).toBeVisible({ timeout: 15_000 });
  await addAiButton.click();
  await expect(addAiButton).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
}

test.describe('mobile roll timing pointer capture regression', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('Galaxy 터치 시작 시점이 Perfect이고 click 처리 시점이 Good이어도 Perfect로 판정한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(120_000);
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'timing-host'));
    const roomTitle = makeQaName(testInfo, 'timing-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    });

    await runQaStep(testInfo, 'AI 게임 시작과 순서 정하기 완료 후 내 던지기 차례 대기', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await addAiAndWaitUntilGameCanStart(page);
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        const debug = state.yutDebug ?? {};
        const hasTurnOrder = Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length >= 2;
        const orderingCleared = !debug.turnOrderPhase?.active && !debug.turnOrderIntro
          && !state.turnOrder.phaseOverlayVisible && !state.turnOrder.introOverlayVisible && !state.turnOrder.lockVisible;
        return hasTurnOrder && orderingCleared ? 'resolved' : JSON.stringify(state, null, 2);
      }, { timeout: 35_000, message: '고정된 순서 결과로 순서 정하기가 완료되어야 합니다.' }).toBe('resolved');
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        return state.rollButton.visible && !state.rollButton.disabled ? 'ready' : JSON.stringify(state, null, 2);
      }, { timeout: 20_000, message: '순서 정하기 완료 후 내 차례 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');
    });

    const sampledPositions = await runQaStep(testInfo, 'pointerdown 시점과 click 시점 분리', async () => page.evaluate(() => {
      const meter = document.querySelector('.roll-timing-meter');
      const track = document.querySelector('.roll-timing-orb-track');
      const orb = document.querySelector('.roll-timing-orb');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (!(meter instanceof HTMLElement) || !(track instanceof HTMLElement) || !(orb instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
        throw new Error('타이밍 막대 또는 던지기 버튼을 찾지 못했습니다.');
      }
      const animation = track.getAnimations()[0];
      if (!animation) throw new Error('타이밍 orb track animation을 찾지 못했습니다.');
      const readPositionPercent = () => {
        const meterRect = meter.getBoundingClientRect();
        const orbRect = orb.getBoundingClientRect();
        return ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100;
      };

      animation.pause();
      animation.currentTime = 500;
      const pointerDownPositionPercent = readPositionPercent();
      const pointerId = 17;
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: 1,
      }));

      animation.currentTime = 800;
      const clickPositionPercent = readPositionPercent();
      button.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: 0,
      }));
      button.click();
      return { pointerDownPositionPercent, clickPositionPercent };
    }));

    expect(sampledPositions.pointerDownPositionPercent).toBeGreaterThanOrEqual(49);
    expect(sampledPositions.pointerDownPositionPercent).toBeLessThanOrEqual(51);
    expect(sampledPositions.clickPositionPercent).toBeGreaterThanOrEqual(79);
    expect(sampledPositions.clickPositionPercent).toBeLessThanOrEqual(81);

    await runQaStep(testInfo, '제출된 타이밍 등급 확인', async () => {
      const resultHoldStage = page.locator('.roll-stage.resolved-from-pending.result-hold-roll');
      await expect(resultHoldStage).toBeVisible({ timeout: 8_000 });
      await expect(resultHoldStage.locator('.roll-stage-timing')).toHaveText('PERFECT', { timeout: 2_000 });
    });
  });
});
