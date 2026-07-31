import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa } from '../helpers/rooms.js';

const POSITION_TOLERANCE_PERCENT = 0.25;
const TURN_NETWORK_GRACE_MIN_OBSERVED_MS = 700;

function getExpectedGrade(positionPercent) {
  if (positionPercent >= 45 && positionPercent <= 55) return 'perfect';
  if ((positionPercent >= 40 && positionPercent < 45) || (positionPercent > 55 && positionPercent <= 60)) return 'nice';
  if ((positionPercent >= 20 && positionPercent < 40) || (positionPercent > 60 && positionPercent <= 80)) return 'good';
  return 'bad';
}

function getExpectedPosition(initialPositionPercent, elapsedMs) {
  const initialPhaseMs = (initialPositionPercent / 100) * 1000;
  const phaseMs = ((initialPhaseMs + elapsedMs) % 2000 + 2000) % 2000;
  return phaseMs <= 1000 ? phaseMs / 10 : (2000 - phaseMs) / 10;
}

async function startTimingGame(page, context, testInfo, initialPositionPercent) {
  await page.setViewportSize({ width: 412, height: 915 });
  const hostName = normalizeQaNickname(makeQaName(testInfo, `timeout-host-${initialPositionPercent}`));
  const roomTitle = makeQaName(testInfo, `timeout-room-${initialPositionPercent}`);
  await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await context.addInitScript(({ fixedInitialPositionPercent }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = fixedInitialPositionPercent;
  }, { fixedInitialPositionPercent: initialPositionPercent });

  await createRoomFromLobby(page, roomTitle);
  const roomId = await waitForRoomQaAccess(page, { roomTitle });
  const addAiButton = page.getByTestId('add-ai-P2');
  await expect(addAiButton).toBeVisible({ timeout: 15_000 });
  await expect(addAiButton).toBeEnabled({ timeout: 15_000 });
  await addAiButton.evaluate((button) => button.click());
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('start-game-button').evaluate((button) => button.click());
  await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    const hasTurnOrder = Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length >= 2;
    const orderingCleared = !debug.turnOrderPhase?.active && !debug.turnOrderIntro
      && !state.turnOrder.phaseOverlayVisible && !state.turnOrder.introOverlayVisible && !state.turnOrder.lockVisible;
    const rollReady = state.rollButton.visible && !state.rollButton.disabled;
    return hasTurnOrder && orderingCleared && rollReady ? 'ready' : JSON.stringify(state, null, 2);
  }, { timeout: 45_000, message: '고정된 순서 결과 이후 첫 윷 던지기 제한시간이 시작되어야 합니다.' }).toBe('ready');
  return roomId;
}

async function getLatestSequenceNumber(roomId) {
  const sequences = await getRoomSequencesForQa(roomId);
  return Math.max(0, ...sequences.map((sequence) => Number(sequence.sequence ?? 0)));
}

async function runTimeoutDeadlineScenario(page, context, testInfo, initialPositionPercent, expectedTimeoutGrade) {
  test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
  testInfo.setTimeout(180_000);
  const roomId = await startTimingGame(page, context, testInfo, initialPositionPercent);
  const beforeSequence = await getLatestSequenceNumber(roomId);

  try {
    const firstVisible = await page.evaluate(() => {
      const timer = document.querySelector('.turn-action-timer');
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (!(timer instanceof HTMLElement) || !(meter instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
        throw new Error('제한시간 막대, 타이밍 오브, 윷 던지기 버튼을 찾지 못했습니다.');
      }
      const durationMs = Number.parseFloat(getComputedStyle(timer).getPropertyValue('--timer-duration'));
      return {
        observedAt: Date.now(),
        deadlineAt: Number(timer.dataset.deadlineAt),
        animationDelayMs: Number(timer.dataset.animationDelayMs),
        durationMs,
        initialPositionPercent: Number(meter.dataset.initialPositionPercent),
        timingStartedAt: Number(meter.dataset.timingStartedAt),
        timingDeadlineAt: Number(meter.dataset.timingDeadlineAt),
        buttonDisabled: button.disabled,
      };
    });

    expect(firstVisible.initialPositionPercent).toBe(initialPositionPercent);
    expect(firstVisible.buttonDisabled).toBe(false);
    expect(firstVisible.deadlineAt).toBe(firstVisible.timingDeadlineAt);
    expect(firstVisible.durationMs).toBeGreaterThan(0);
    expect(firstVisible.animationDelayMs).toBeLessThanOrEqual(0);
    expect(firstVisible.animationDelayMs).toBeGreaterThanOrEqual(-firstVisible.durationMs);
    const animationRemainingMs = firstVisible.durationMs + firstVisible.animationDelayMs;
    const animationCapturedAt = firstVisible.deadlineAt - animationRemainingMs;
    expect(animationCapturedAt).toBeGreaterThanOrEqual(firstVisible.timingStartedAt);
    expect(animationCapturedAt).toBeLessThanOrEqual(firstVisible.observedAt);

    const deadlineState = await runQaStep(testInfo, 'authoritative deadline과 막대 소진·버튼 비활성 상태 일치 확인', () => page.evaluate(async () => {
      const sleep = (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs));
      const deadlineAt = Number(document.querySelector('.turn-action-timer')?.getAttribute('data-deadline-at'));
      const earlyDisabledSamples = [];
      const timeoutAt = performance.now() + 20_000;
      while (performance.now() <= timeoutAt) {
        const now = Date.now();
        const statusButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('시간 초과 처리 중'));
        const rollButton = document.querySelector('[data-testid="roll-yut-button"]');
        const timer = document.querySelector('.turn-action-timer');
        const fill = timer?.querySelector('span');
        if (rollButton instanceof HTMLButtonElement && rollButton.disabled && now < deadlineAt - 50) {
          earlyDisabledSamples.push({ now, deadlineAt });
        }
        if (statusButton instanceof HTMLButtonElement) {
          const animation = fill instanceof HTMLElement ? fill.getAnimations()[0] : undefined;
          const progress = animation?.effect?.getComputedTiming().progress;
          const transform = fill instanceof HTMLElement ? getComputedStyle(fill).transform : '';
          statusButton.click();
          return {
            deadlineAt,
            statusObservedAt: now,
            statusDisabled: statusButton.disabled,
            timerExists: timer instanceof HTMLElement,
            animationProgress: typeof progress === 'number' ? progress : null,
            transform,
            earlyDisabledSamples,
          };
        }
        await sleep(20);
      }
      throw new Error('authoritative deadline 이후 시간 초과 처리 상태가 표시되지 않았습니다.');
    }));

    expect(deadlineState.earlyDisabledSamples).toEqual([]);
    expect(deadlineState.statusObservedAt).toBeGreaterThanOrEqual(deadlineState.deadlineAt);
    expect(deadlineState.statusDisabled).toBe(true);
    expect(deadlineState.timerExists).toBe(true);
    if (deadlineState.animationProgress !== null) expect(deadlineState.animationProgress).toBeGreaterThanOrEqual(0.99);

    let timedOutSequence;
    let firstObservedAt = 0;
    await expect.poll(async () => {
      const sequences = await getRoomSequencesForQa(roomId);
      const candidates = sequences.filter((sequence) => (
        sequence.type === 'roll_yut'
        && Number(sequence.sequence ?? 0) > beforeSequence
        && (sequence.action?.payload?.timedOut === true || sequence.payload?.timedOut === true)
      ));
      timedOutSequence = candidates[0];
      if (timedOutSequence && !firstObservedAt) firstObservedAt = Date.now();
      return candidates.length;
    }, {
      timeout: 20_000,
      intervals: [100, 200, 400],
      message: 'network grace 종료 후 timedOut roll_yut sequence가 정확히 한 번 저장되어야 합니다.',
    }).toBe(1);

    expect(firstObservedAt).toBeGreaterThanOrEqual(deadlineState.deadlineAt + TURN_NETWORK_GRACE_MIN_OBSERVED_MS);
    const elapsedMs = firstVisible.timingDeadlineAt - firstVisible.timingStartedAt;
    const expectedPositionPercent = getExpectedPosition(initialPositionPercent, elapsedMs);
    const actionPayload = timedOutSequence?.action?.payload ?? {};
    const submittedPositionPercent = Number(actionPayload.timingPositionPercent);
    expect(Math.abs(submittedPositionPercent - expectedPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
    expect(actionPayload.rollTimingZone).toBe(expectedTimeoutGrade);
    expect(getExpectedGrade(submittedPositionPercent)).toBe(expectedTimeoutGrade);

    await expect(page.locator('.roll-stage')).toBeVisible({ timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const finalSequences = await getRoomSequencesForQa(roomId);
    const duplicateCount = finalSequences.filter((sequence) => (
      sequence.type === 'roll_yut'
      && Number(sequence.sequence ?? 0) > beforeSequence
      && (sequence.action?.payload?.timedOut === true || sequence.payload?.timedOut === true)
    )).length;
    expect(duplicateCount).toBe(1);
    await expect(page.getByTestId('game-screen')).toBeVisible();
  } finally {
    await deleteRoomForQa(roomId).catch(() => undefined);
  }
}

test.describe('Galaxy online timeout deadline and timing snapshot regression', () => {
  test('0% 초기 위치의 timeout은 동일 deadline 위치로 Bad를 제출한다', async ({ page, context }, testInfo) => {
    await runTimeoutDeadlineScenario(page, context, testInfo, 0, 'bad');
  });

  test('30% 초기 위치의 timeout은 고정 Bad가 아니라 동일 deadline 위치의 Good을 제출한다', async ({ page, context }, testInfo) => {
    await runTimeoutDeadlineScenario(page, context, testInfo, 30, 'good');
  });
});
