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

async function startAiTimingGame(page, context, testInfo) {
  testInfo.setTimeout(120_000);
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'timing-host'));
  const roomTitle = makeQaName(testInfo, 'timing-room');
  await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await context.addInitScript(() => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
  });

  let resolvedRoomId;
  await runQaStep(testInfo, 'AI 게임 시작과 순서 정하기 완료 후 내 던지기 차례 대기', async () => {
    await createRoomFromLobby(page, roomTitle);
    resolvedRoomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
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
  return resolvedRoomId;
}

async function dispatchTimingGesture(page, { releaseInside }) {
  return page.evaluate(({ releaseInside: shouldReleaseInside }) => {
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
    animation.currentTime = 390;
    const pointerDownPositionPercent = readPositionPercent();
    const buttonRect = button.getBoundingClientRect();
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
    const releaseX = shouldReleaseInside ? buttonCenterX : buttonRect.right + 24;
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
      clientX: buttonCenterX,
      clientY: buttonCenterY,
    }));

    animation.currentTime = 500;
    const pointerUpPositionPercent = readPositionPercent();
    button.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: releaseX,
      clientY: buttonCenterY,
    }));
    button.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 1,
    }));
    return { pointerDownPositionPercent, pointerUpPositionPercent };
  }, { releaseInside });
}

test.describe('mobile roll timing release regression', () => {
  let roomId;

  test.beforeEach(() => {
    roomId = undefined;
  });

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('터치 시작이 Good이어도 손을 뗀 시점이 Perfect이면 화면과 동일하게 Perfect로 판정한다', async ({ page, context }, testInfo) => {
    roomId = await startAiTimingGame(page, context, testInfo);

    const sampledPositions = await runQaStep(testInfo, 'Good에서 누르고 Perfect에서 손을 뗀 위치 확인', async () => dispatchTimingGesture(page, { releaseInside: true }));
    expect(sampledPositions.pointerDownPositionPercent).toBeGreaterThanOrEqual(38);
    expect(sampledPositions.pointerDownPositionPercent).toBeLessThanOrEqual(40);
    expect(sampledPositions.pointerUpPositionPercent).toBeGreaterThanOrEqual(49);
    expect(sampledPositions.pointerUpPositionPercent).toBeLessThanOrEqual(51);

    await runQaStep(testInfo, '손을 뗀 위치와 제출된 타이밍 등급 확인', async () => {
      const resultHoldStage = page.locator('.roll-stage.resolved-from-pending.result-hold-roll');
      await expect(resultHoldStage).toBeVisible({ timeout: 8_000 });
      await expect(resultHoldStage.locator('.roll-stage-timing')).toHaveText('PERFECT', { timeout: 2_000 });
      await page.waitForTimeout(150);
      await expect(resultHoldStage.locator('.roll-stage-timing')).toHaveText('PERFECT');
    });
  });

  test('버튼 밖으로 손을 떼면 브라우저 후속 click이 발생해도 던지지 않는다', async ({ page, context }, testInfo) => {
    roomId = await startAiTimingGame(page, context, testInfo);

    await runQaStep(testInfo, '버튼 밖 release와 후속 click 입력', async () => {
      await dispatchTimingGesture(page, { releaseInside: false });
      await page.waitForTimeout(200);
    });

    await runQaStep(testInfo, '취소된 입력이 roll을 제출하지 않았는지 확인', async () => {
      await expect(page.locator('.roll-stage.resolved-from-pending.result-hold-roll')).toHaveCount(0);
      await expect(page.getByTestId('roll-yut-button')).toBeVisible();
      await expect(page.getByTestId('roll-yut-button')).toBeEnabled();
    });
  });
});
