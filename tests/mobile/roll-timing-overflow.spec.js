import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const POSITION_TOLERANCE_PERCENT = 0.25;

async function addAiAndWaitUntilGameCanStart(page) {
  const addAiButton = page.getByTestId('add-ai-P2');
  await expect(addAiButton).toBeVisible({ timeout: 15_000 });
  await expect(addAiButton).toBeEnabled({ timeout: 15_000 });
  await addAiButton.evaluate((button) => button.click());
  await expect(addAiButton).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
}

async function startAiTimingGame(page, context, testInfo) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'overflow-host'));
  const roomTitle = makeQaName(testInfo, 'overflow-room');
  await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await context.addInitScript(() => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
  });

  await createRoomFromLobby(page, roomTitle);
  let roomId;
  await expect.poll(async () => {
    roomId = await rememberRoomIdFromPage(page).catch(() => undefined);
    return roomId ?? '';
  }, { timeout: 5_000, message: '생성된 방의 QA cleanup 권한이 준비되어야 합니다.' }).not.toBe('');
  roomId ??= await findRoomIdByTitle(roomTitle);
  await addAiAndWaitUntilGameCanStart(page);
  await page.getByTestId('start-game-button').evaluate((button) => button.click());
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 25_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    const hasTurnOrder = Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length >= 2;
    const orderingCleared = !debug.turnOrderPhase?.active && !debug.turnOrderIntro
      && !state.turnOrder.phaseOverlayVisible && !state.turnOrder.introOverlayVisible && !state.turnOrder.lockVisible;
    return hasTurnOrder && orderingCleared && state.rollButton.visible && !state.rollButton.disabled
      ? 'ready'
      : JSON.stringify(state, null, 2);
  }, { timeout: 45_000, message: '순서 정하기 완료 후 내 차례 타이밍 막대가 활성화되어야 합니다.' }).toBe('ready');
  return roomId;
}

test.describe('mobile roll timing horizontal overflow regression', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = '';
  });

  test('오브는 고정 트랙 안에서 0·50·100%를 표시하며 이동 중 문서 가로 폭과 scrollLeft를 바꾸지 않는다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    roomId = await startAiTimingGame(page, context, testInfo);

    const result = await runQaStep(testInfo, '고정 트랙 경계 위치와 이동 중 가로 overflow 확인', async () => page.evaluate(async () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const track = meter?.querySelector('.roll-timing-orb-track');
      const orb = meter?.querySelector('.roll-timing-orb');
      if (!(meter instanceof HTMLElement) || !(track instanceof HTMLElement) || !(orb instanceof HTMLElement)) {
        throw new Error('타이밍 막대 또는 오브를 찾지 못했습니다.');
      }

      const readHorizontalState = () => ({
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollLeft: document.documentElement.scrollLeft,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollLeft: document.body.scrollLeft,
        windowScrollX: window.scrollX,
      });
      const readPosition = (positionPercent) => {
        orb.style.left = `${positionPercent}%`;
        const meterRect = meter.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const orbRect = orb.getBoundingClientRect();
        const meterContentLeft = meterRect.left + meter.clientLeft;
        return {
          requestedPositionPercent: positionPercent,
          visiblePositionPercent: ((orbRect.left + orbRect.width / 2 - meterContentLeft) / meter.clientWidth) * 100,
          meterWidth: meter.clientWidth,
          trackWidth: trackRect.width,
          trackLeftDelta: trackRect.left - meterContentLeft,
          inlineTrackTransform: track.style.transform,
          computedTrackTransform: getComputedStyle(track).transform,
          horizontal: readHorizontalState(),
        };
      };

      const baseline = readHorizontalState();
      const originalOrbLeft = orb.style.left;
      const boundarySamples = [0, 50, 100].map(readPosition);
      orb.style.left = originalOrbLeft;

      const movementSamples = [];
      for (let index = 0; index < 16; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        movementSamples.push({
          positionPercent: Number(meter.dataset.positionPercent),
          orbLeft: orb.style.left,
          trackTransform: track.style.transform,
          horizontal: readHorizontalState(),
        });
      }

      return {
        baseline,
        boundarySamples,
        movementSamples,
        htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
        bodyOverflowX: getComputedStyle(document.body).overflowX,
      };
    }));

    expect(result.htmlOverflowX).not.toBe('hidden');
    expect(result.bodyOverflowX).not.toBe('hidden');
    expect(result.boundarySamples).toHaveLength(3);
    for (const sample of result.boundarySamples) {
      expect(Math.abs(sample.visiblePositionPercent - sample.requestedPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
      expect(Math.abs(sample.trackWidth - sample.meterWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.trackLeftDelta)).toBeLessThanOrEqual(1);
      expect(sample.inlineTrackTransform).toBe('none');
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(sample.computedTrackTransform);
      expect(sample.horizontal.documentScrollWidth).toBe(result.baseline.documentScrollWidth);
      expect(sample.horizontal.bodyScrollWidth).toBe(result.baseline.bodyScrollWidth);
      expect(sample.horizontal.documentScrollLeft).toBe(result.baseline.documentScrollLeft);
      expect(sample.horizontal.bodyScrollLeft).toBe(result.baseline.bodyScrollLeft);
      expect(sample.horizontal.windowScrollX).toBe(result.baseline.windowScrollX);
    }

    const observedPositions = result.movementSamples.map((sample) => sample.positionPercent).filter(Number.isFinite);
    expect(new Set(observedPositions.map((position) => Math.round(position * 10))).size).toBeGreaterThan(1);
    for (const sample of result.movementSamples) {
      expect(sample.trackTransform).toBe('none');
      expect(sample.orbLeft).toMatch(/%$/);
      expect(sample.horizontal.documentScrollWidth).toBe(result.baseline.documentScrollWidth);
      expect(sample.horizontal.bodyScrollWidth).toBe(result.baseline.bodyScrollWidth);
      expect(sample.horizontal.documentScrollLeft).toBe(result.baseline.documentScrollLeft);
      expect(sample.horizontal.bodyScrollLeft).toBe(result.baseline.bodyScrollLeft);
      expect(sample.horizontal.windowScrollX).toBe(result.baseline.windowScrollX);
    }
  });
});
