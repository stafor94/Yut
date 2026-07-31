import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa } from '../helpers/rooms.js';

const POSITION_TOLERANCE_PERCENT = 0.25;

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

async function startTimingGame(page, context, testInfo, initialPositionPercent, options = {}) {
  const { scenario = 'normal', actionDelayMs = 0, failCommitCount = 0 } = options;
  await page.setViewportSize({ width: 412, height: 915 });
  const hostName = normalizeQaNickname(makeQaName(testInfo, `timeout-host-${initialPositionPercent}-${scenario}`));
  const roomTitle = makeQaName(testInfo, `timeout-room-${initialPositionPercent}-${scenario}`);
  await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await context.addInitScript(({ fixedInitialPositionPercent, configuredActionDelayMs, configuredFailCommitCount }) => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
    window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = fixedInitialPositionPercent;
    window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = configuredActionDelayMs;
    window.__YUT_QA_FAIL_TIMEOUT_ROLL_COMMIT_COUNT__ = configuredFailCommitCount;
    window.__YUT_QA_TIMEOUT_ROLL_COMMIT_ATTEMPTS__ = 0;
    window.__YUT_QA_TIMEOUT_PRESENTATION__ = { timingGradeStarts: 0, resultDisplays: 0, resultNames: [], vibrationCalls: 0 };
    const presentationState = window.__YUT_QA_TIMEOUT_PRESENTATION__;
    const originalVibrate = typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : null;
    try {
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (...args) => {
          presentationState.vibrationCalls += 1;
          return originalVibrate ? originalVibrate(...args) : true;
        },
      });
    } catch {
      // 읽기 전용 navigator 구현에서는 DOM presentation 계측만 사용한다.
    }
    let lastTimingGradeNode = null;
    let resultWasVisible = false;
    const samplePresentation = () => {
      const timingGradeNode = document.querySelector('[data-testid="roll-timing-grade"]');
      if (timingGradeNode && timingGradeNode !== lastTimingGradeNode) presentationState.timingGradeStarts += 1;
      lastTimingGradeNode = timingGradeNode;
      const resultPresentation = document.querySelector('[data-testid="roll-result-presentation"]');
      const resultVisible = resultPresentation instanceof HTMLElement
        && !resultPresentation.hidden
        && resultPresentation.getAttribute('aria-hidden') !== 'true';
      if (resultVisible && !resultWasVisible) {
        presentationState.resultDisplays += 1;
        presentationState.resultNames.push(resultPresentation.querySelector('.roll-result-name')?.textContent?.trim() ?? '');
      }
      resultWasVisible = resultVisible;
      window.requestAnimationFrame(samplePresentation);
    };
    window.requestAnimationFrame(samplePresentation);
  }, {
    fixedInitialPositionPercent: initialPositionPercent,
    configuredActionDelayMs: actionDelayMs,
    configuredFailCommitCount: failCommitCount,
  });

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

async function getPresentationState(page) {
  return page.evaluate(() => ({
    timingGradeStarts: Number(window.__YUT_QA_TIMEOUT_PRESENTATION__?.timingGradeStarts ?? 0),
    resultDisplays: Number(window.__YUT_QA_TIMEOUT_PRESENTATION__?.resultDisplays ?? 0),
    resultNames: [...(window.__YUT_QA_TIMEOUT_PRESENTATION__?.resultNames ?? [])],
    vibrationCalls: Number(window.__YUT_QA_TIMEOUT_PRESENTATION__?.vibrationCalls ?? 0),
    commitAttempts: Number(window.__YUT_QA_TIMEOUT_ROLL_COMMIT_ATTEMPTS__ ?? 0),
  }));
}

async function runTimeoutDeadlineScenario(page, context, testInfo, initialPositionPercent, expectedTimeoutGrade, options = {}) {
  test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
  testInfo.setTimeout(210_000);
  const { scenario = 'normal', actionDelayMs = 0, failCommitCount = 0, expectCoordinatorRecovery = false, simulateReconnect = false } = options;
  const roomId = await startTimingGame(page, context, testInfo, initialPositionPercent, { scenario, actionDelayMs, failCommitCount });
  const beforeSequence = await getLatestSequenceNumber(roomId);
  try {
    const firstVisible = await page.evaluate(() => {
      const timer = document.querySelector('.turn-action-timer');
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (!(timer instanceof HTMLElement) || !(meter instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) throw new Error('제한시간 막대, 타이밍 오브, 윷 던지기 버튼을 찾지 못했습니다.');
      const durationMs = Number.parseFloat(getComputedStyle(timer).getPropertyValue('--timer-duration'));
      const presentation = window.__YUT_QA_TIMEOUT_PRESENTATION__ ?? {};
      return {
        observedAt: Date.now(), deadlineAt: Number(timer.dataset.deadlineAt), animationDelayMs: Number(timer.dataset.animationDelayMs), durationMs,
        initialPositionPercent: Number(meter.dataset.initialPositionPercent), timingStartedAt: Number(meter.dataset.timingStartedAt), timingDeadlineAt: Number(meter.dataset.timingDeadlineAt),
        buttonDisabled: button.disabled, baselineTimingGradeStarts: Number(presentation.timingGradeStarts ?? 0), baselineResultDisplays: Number(presentation.resultDisplays ?? 0), baselineVibrationCalls: Number(presentation.vibrationCalls ?? 0),
      };
    });
    expect(firstVisible.initialPositionPercent).toBe(initialPositionPercent);
    expect(firstVisible.buttonDisabled).toBe(false);
    expect(firstVisible.deadlineAt).toBe(firstVisible.timingDeadlineAt);
    expect(firstVisible.durationMs).toBeGreaterThan(0);
    expect(firstVisible.animationDelayMs).toBeLessThanOrEqual(0);
    expect(firstVisible.animationDelayMs).toBeGreaterThanOrEqual(-firstVisible.durationMs);
    const animationCapturedAt = firstVisible.deadlineAt - (firstVisible.durationMs + firstVisible.animationDelayMs);
    expect(animationCapturedAt).toBeGreaterThanOrEqual(firstVisible.timingStartedAt);
    expect(animationCapturedAt).toBeLessThanOrEqual(firstVisible.observedAt);

    if (simulateReconnect) {
      await expect.poll(() => Date.now(), { timeout: 20_000, intervals: [20, 50] }).toBeGreaterThanOrEqual(firstVisible.deadlineAt - 250);
      await context.setOffline(true);
    }

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
        if (rollButton instanceof HTMLButtonElement && rollButton.disabled && now < deadlineAt - 50) earlyDisabledSamples.push({ now, deadlineAt });
        if (statusButton instanceof HTMLButtonElement) {
          const progress = fill instanceof HTMLElement ? fill.getAnimations()[0]?.effect?.getComputedTiming().progress : null;
          statusButton.click();
          return { deadlineAt, statusObservedAt: now, statusDisabled: statusButton.disabled, timerExists: timer instanceof HTMLElement, animationProgress: typeof progress === 'number' ? progress : null, earlyDisabledSamples };
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

    await expect(page.locator('.roll-stage')).toBeVisible({ timeout: 10_000 });
    if (simulateReconnect) {
      await context.setOffline(false);
      await page.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
    }

    let timedOutSequence;
    let firstObservedAt = 0;
    await expect.poll(async () => {
      const sequences = await getRoomSequencesForQa(roomId);
      const candidates = sequences.filter((sequence) => sequence.type === 'roll_yut' && Number(sequence.sequence ?? 0) > beforeSequence && (sequence.action?.payload?.timedOut === true || sequence.payload?.timedOut === true));
      timedOutSequence = candidates[0];
      if (timedOutSequence && !firstObservedAt) firstObservedAt = Date.now();
      return candidates.length;
    }, { timeout: 30_000, intervals: [100, 200, 400], message: 'timedOut roll_yut sequence가 정확히 한 번 저장되어야 합니다.' }).toBe(1);

    expect(firstObservedAt).toBeGreaterThanOrEqual(deadlineState.deadlineAt);
    const expectedPositionPercent = getExpectedPosition(initialPositionPercent, firstVisible.timingDeadlineAt - firstVisible.timingStartedAt);
    const actionPayload = timedOutSequence?.action?.payload ?? timedOutSequence?.payload ?? {};
    const submittedPositionPercent = Number(actionPayload.timingPositionPercent);
    expect(Math.abs(submittedPositionPercent - expectedPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
    expect(actionPayload.rollTimingZone).toBe(expectedTimeoutGrade);
    expect(getExpectedGrade(submittedPositionPercent)).toBe(expectedTimeoutGrade);
    expect(actionPayload.timeoutResolverVersion).toBe(1);
    expect(String(actionPayload.clientActionId ?? '')).toMatch(/^timeout:v1:/);
    if (expectCoordinatorRecovery) expect(String(actionPayload.timeoutRecoveredBy ?? '')).not.toBe('');
    else expect(actionPayload.timeoutRecoveredBy).toBeUndefined();

    const authoritativeResultName = String(actionPayload.clientRollResult?.name ?? '');
    const authoritativeDisplayName = actionPayload.clientFallOccurred === true ? '낙' : authoritativeResultName;
    expect(authoritativeResultName).not.toBe('');
    await expect.poll(async () => (await getPresentationState(page)).resultNames.slice(firstVisible.baselineResultDisplays).at(0) ?? '', { timeout: 20_000, intervals: [50, 100, 200] }).toContain(authoritativeDisplayName);

    await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 25_000 });
    const presentation = await getPresentationState(page);
    expect(presentation.timingGradeStarts - firstVisible.baselineTimingGradeStarts).toBe(1);
    expect(presentation.resultDisplays - firstVisible.baselineResultDisplays).toBe(1);
    expect(presentation.resultNames.slice(firstVisible.baselineResultDisplays)[0]).toContain(authoritativeDisplayName);
    if (failCommitCount === 1) expect(presentation.commitAttempts).toBe(2);
    if (failCommitCount >= 2) expect(presentation.commitAttempts).toBeGreaterThanOrEqual(3);

    const finalSequences = await getRoomSequencesForQa(roomId);
    const timeoutSequences = finalSequences.filter((sequence) => sequence.type === 'roll_yut' && Number(sequence.sequence ?? 0) > beforeSequence && (sequence.action?.payload?.timedOut === true || sequence.payload?.timedOut === true));
    expect(timeoutSequences).toHaveLength(1);
    expect(new Set(timeoutSequences.map((sequence) => String(sequence.action?.payload?.clientActionId ?? sequence.payload?.clientActionId ?? ''))).size).toBe(1);
    await expect(page.getByTestId('game-screen')).toBeVisible();
  } finally {
    if (simulateReconnect) await context.setOffline(false).catch(() => undefined);
    await deleteRoomForQa(roomId).catch(() => undefined);
  }
}

test.describe('Galaxy online timeout deadline and timing snapshot regression', () => {
  test('0% 초기 위치의 timeout은 동일 deadline 위치로 Bad를 한 번만 표시한다', async ({ page, context }, testInfo) => runTimeoutDeadlineScenario(page, context, testInfo, 0, 'bad'));
  test('30% 초기 위치의 timeout은 고정 Bad가 아니라 동일 deadline 위치의 Good을 한 번만 표시한다', async ({ page, context }, testInfo) => runTimeoutDeadlineScenario(page, context, testInfo, 30, 'good'));
  test('UI 제출 지연으로 fallback이 먼저 확정해도 같은 결과를 한 번만 표시한다', async ({ page, context }, testInfo) => runTimeoutDeadlineScenario(page, context, testInfo, 30, 'good', { scenario: 'coordinator-first', actionDelayMs: 2_500, expectCoordinatorRecovery: true }));
  test('첫 Firestore 제출 실패는 같은 timeout payload로 한 번만 재시도한다', async ({ page, context }, testInfo) => runTimeoutDeadlineScenario(page, context, testInfo, 30, 'good', { scenario: 'retry-once', failCommitCount: 1 }));
  test('UI 제출과 동일 payload 재시도가 모두 실패하면 같은 canonical fallback이 확정한다', async ({ page, context }, testInfo) => runTimeoutDeadlineScenario(page, context, testInfo, 30, 'good', { scenario: 'coordinator-fallback', failCommitCount: 2, expectCoordinatorRecovery: true }));
  test('deadline 직전 오프라인 후 재접속해도 로컬 결과와 authoritative 결과가 한 번만 표시된다', async ({ page, context }, testInfo) => runTimeoutDeadlineScenario(page, context, testInfo, 30, 'good', { scenario: 'offline-reconnect', simulateReconnect: true }));
});
