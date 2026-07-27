import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomSequencesForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

const GOOD_PRESS_RANGE = Object.freeze([28, 36]);
const LONG_PRESS_MS = 180;
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
  const hostName = normalizeQaNickname(makeQaName(testInfo, 'safari-visible-host'));
  const roomTitle = makeQaName(testInfo, 'safari-visible-room');
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
  await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
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

async function getLatestSequenceNumber(roomId) {
  const sequences = await getRoomSequencesForQa(roomId);
  return Math.max(0, ...sequences.map((sequence) => Number(sequence.sequence ?? 0)));
}

async function waitForRollSequence(roomId, afterSequence) {
  let resolvedSequence;
  await expect.poll(async () => {
    const sequences = await getRoomSequencesForQa(roomId);
    resolvedSequence = sequences
      .filter((sequence) => sequence.type === 'roll_yut' && Number(sequence.sequence ?? 0) > afterSequence)
      .sort((left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0))[0];
    return resolvedSequence ? Number(resolvedSequence.sequence ?? 0) : 0;
  }, {
    timeout: 20_000,
    intervals: [100, 200, 400, 800, 1200],
    message: `sequence #${afterSequence} 이후 authoritative roll_yut sequence가 저장되어야 합니다.`,
  }).toBeGreaterThan(afterSequence);
  return resolvedSequence;
}

test.describe('Safari visible timing snapshot regression', () => {
  let roomId = '';

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = '';
  });

  test('Safari에서 rAF로 관찰한 Good pointerdown snapshot은 180ms 뒤에도 화면·hold·제출·최종 판정이 Good으로 일치한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    roomId = await startAiTimingGame(page, context, testInfo);
    const beforeSequence = await getLatestSequenceNumber(roomId);

    const gesture = await runQaStep(testInfo, 'Safari 실제 rAF Good snapshot 고정과 authoritative 제출 확인', async () => page.evaluate(async ({ targetRange, holdMs }) => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const orb = meter?.querySelector('.roll-timing-orb');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (!(meter instanceof HTMLElement) || !(orb instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
        throw new Error('타이밍 막대 또는 던지기 버튼을 찾지 못했습니다.');
      }

      const readSnapshot = (targetMeter = meter) => ({
        positionPercent: Number(targetMeter.dataset.positionPercent),
        phaseMs: Number(targetMeter.dataset.phaseMs),
        capturedAt: Number(targetMeter.dataset.capturedAt),
        resetKey: targetMeter.dataset.resetKey ?? '',
      });
      const readVisiblePositionPercent = (targetMeter = meter, targetOrb = orb) => {
        const meterRect = targetMeter.getBoundingClientRect();
        const orbRect = targetOrb.getBoundingClientRect();
        const contentLeft = meterRect.left + targetMeter.clientLeft;
        return ((orbRect.left + orbRect.width / 2 - contentLeft) / targetMeter.clientWidth) * 100;
      };
      const waitForCondition = async (condition, timeoutMs, message, useAnimationFrame = false) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() <= deadline) {
          const value = condition();
          if (value) return value;
          await new Promise((resolve) => (useAnimationFrame ? requestAnimationFrame(resolve) : window.setTimeout(resolve, 16)));
        }
        throw new Error(message);
      };

      const targetSnapshot = await waitForCondition(() => {
        const snapshot = readSnapshot();
        return Number.isFinite(snapshot.positionPercent)
          && Number.isFinite(snapshot.phaseMs)
          && snapshot.phaseMs < 1000
          && snapshot.positionPercent >= targetRange[0]
          && snapshot.positionPercent <= targetRange[1]
          ? snapshot
          : null;
      }, 5000, `Safari rAF 목표 위치를 찾지 못했습니다: ${JSON.stringify(targetRange)}`, true);

      const buttonRect = button.getBoundingClientRect();
      const pointerId = 31;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: buttonRect.left + buttonRect.width / 2,
        clientY: buttonRect.top + buttonRect.height / 2,
      };
      button.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, buttons: 1 }));
      const pointerDownSnapshot = readSnapshot();
      const pointerDownVisiblePositionPercent = readVisiblePositionPercent();
      const pressedAt = performance.now();
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, pressedAt + holdMs - performance.now())));
      const heldSnapshot = readSnapshot();
      const heldVisiblePositionPercent = readVisiblePositionPercent();

      const nativeRandom = Math.random;
      Math.random = () => 0.9;
      try {
        button.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, buttons: 0 }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 1 }));
      } finally {
        Math.random = nativeRandom;
      }

      const heldMeter = await waitForCondition(
        () => document.querySelector('[data-testid="roll-timing-result-hold"]'),
        1000,
        'Safari 결과 고정 막대가 생성되지 않았습니다.',
      );
      if (!(heldMeter instanceof HTMLElement)) throw new Error('결과 고정 막대가 HTMLElement가 아닙니다.');
      const heldOrb = heldMeter.querySelector('.roll-timing-orb');
      if (!(heldOrb instanceof HTMLElement)) throw new Error('결과 고정 오브를 찾지 못했습니다.');
      const resultHoldSnapshot = readSnapshot(heldMeter);
      const resultHoldVisiblePositionPercent = readVisiblePositionPercent(heldMeter, heldOrb);
      const holdRect = heldMeter.getBoundingClientRect();
      const currentButtonRect = button.getBoundingClientRect();
      const overlapsButton = holdRect.left < currentButtonRect.right && holdRect.right > currentButtonRect.left
        && holdRect.top < currentButtonRect.bottom && holdRect.bottom > currentButtonRect.top;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const resultHoldVisibleAt500Ms = heldMeter.isConnected
        && getComputedStyle(heldMeter).display !== 'none'
        && getComputedStyle(heldMeter).visibility !== 'hidden';

      const submission = await waitForCondition(() => {
        const submittedGrade = Array.from(document.querySelectorAll('.roll-timing-feedback, .roll-stage-timing, [role="status"]'))
          .map((element) => element.textContent?.trim() ?? '')
          .find((text) => ['PERFECT', 'NICE', 'GOOD', 'BAD'].includes(text)) ?? '';
        const rollLog = Array.from(document.querySelectorAll('.game-log p, aside p, [aria-label="진행 기록"] p'))
          .map((element) => element.textContent?.trim() ?? '')
          .find((text) => text.includes('던졌습니다.')) ?? '';
        return submittedGrade && rollLog ? { submittedGrade, rollLog } : null;
      }, 20_000, 'Safari timing 제출 결과를 확인하지 못했습니다.');

      return {
        targetSnapshot,
        pointerDownSnapshot,
        pointerDownVisiblePositionPercent,
        heldSnapshot,
        heldVisiblePositionPercent,
        resultHoldSnapshot,
        resultHoldVisiblePositionPercent,
        resultHoldVisibleAt500Ms,
        resultHoldParentIsPlayControls: heldMeter.parentElement?.classList.contains('play-controls') ?? false,
        overlapsButton,
        ...submission,
      };
    }, { targetRange: GOOD_PRESS_RANGE, holdMs: LONG_PRESS_MS }));

    expect(gesture.pointerDownSnapshot).toEqual(gesture.targetSnapshot);
    expect(gesture.heldSnapshot).toEqual(gesture.pointerDownSnapshot);
    expect(gesture.pointerDownSnapshot.positionPercent).toBeGreaterThanOrEqual(GOOD_PRESS_RANGE[0]);
    expect(gesture.pointerDownSnapshot.positionPercent).toBeLessThanOrEqual(GOOD_PRESS_RANGE[1]);
    expect(Math.abs(gesture.pointerDownVisiblePositionPercent - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
    expect(Math.abs(gesture.heldVisiblePositionPercent - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
    expect(gesture.resultHoldSnapshot.positionPercent).toBe(gesture.pointerDownSnapshot.positionPercent);
    expect(gesture.resultHoldSnapshot.phaseMs).toBe(gesture.pointerDownSnapshot.phaseMs);
    expect(Math.abs(gesture.resultHoldVisiblePositionPercent - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
    expect(gesture.resultHoldVisibleAt500Ms).toBe(true);
    expect(gesture.resultHoldParentIsPlayControls).toBe(true);
    expect(gesture.overlapsButton).toBe(false);
    expect(gesture.submittedGrade).toBe('GOOD');
    expect(gesture.rollLog).toContain('던졌습니다.');

    const hypotheticalPointerUpPosition = gesture.pointerDownSnapshot.positionPercent + LONG_PRESS_MS / 10;
    expect(hypotheticalPointerUpPosition).toBeGreaterThanOrEqual(45);
    expect(hypotheticalPointerUpPosition).toBeLessThanOrEqual(55);

    const sequence = await waitForRollSequence(roomId, beforeSequence);
    const actionPayload = sequence?.action?.payload ?? {};
    const sequencePayload = sequence?.payload ?? {};
    const patch = sequence?.patch ?? {};
    expect(Math.abs(Number(actionPayload.timingPositionPercent) - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
    expect(actionPayload.rollTimingZone).toBe('good');
    expect(sequencePayload.timingZone).toBe('good');
    expect(patch.lastRollTimingZone).toBe('good');
  });
});
