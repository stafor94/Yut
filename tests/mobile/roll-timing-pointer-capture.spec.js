import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa, getRoomSequencesForQa } from '../helpers/rooms.js';

const GOOD_PRESS_RANGES = Object.freeze([[27, 37], [63, 73]]);
const NICE_PRESS_RANGES = Object.freeze([[40.5, 44.5], [55.5, 59.5]]);
const GOOD_CANCEL_RANGES = Object.freeze([[20.5, 39.5], [60.5, 79.5]]);
const POSITION_TOLERANCE_PERCENT = 0.25;
const LONG_PRESS_MS = 180;
const ROLL_TIMING_CYCLE_MS = 2000;
const POINTER_SPEC_MODE = process.env.QA_ROLE === 'safari-timing' ? 'default' : 'parallel';

function getExpectedGrade(positionPercent) {
  if (positionPercent >= 45 && positionPercent <= 55) return 'PERFECT';
  if ((positionPercent >= 40 && positionPercent < 45) || (positionPercent > 55 && positionPercent <= 60)) return 'NICE';
  if ((positionPercent >= 20 && positionPercent < 40) || (positionPercent > 60 && positionPercent <= 80)) return 'GOOD';
  return 'BAD';
}

async function addAiAndWaitUntilGameCanStart(page) {
  const addAiButton = page.getByTestId('add-ai-P2');
  await expect(addAiButton).toBeVisible({ timeout: 15_000 });
  await expect(addAiButton).toBeEnabled({ timeout: 15_000 });
  await addAiButton.evaluate((button) => button.click());
  await expect(addAiButton).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
}

async function startAiTimingGame(page, context, testInfo, attemptLabel = '') {
  const suffix = attemptLabel ? `-${attemptLabel}` : '';
  const hostName = normalizeQaNickname(makeQaName(testInfo, `timing-host${suffix}`));
  const roomTitle = makeQaName(testInfo, `timing-room${suffix}`);
  await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
  await context.addInitScript(() => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
  });

  let resolvedRoomId;
  await runQaStep(testInfo, `AI 게임 시작과 순서 정하기 완료 후 내 던지기 차례 대기${suffix}`, async () => {
    await createRoomFromLobby(page, roomTitle);
    resolvedRoomId = await waitForRoomQaAccess(page, { roomTitle });
    await addAiAndWaitUntilGameCanStart(page);
    const startGameButton = page.getByTestId('start-game-button');
    await expect(startGameButton).toBeVisible({ timeout: 15_000 });
    await expect(startGameButton).toBeEnabled({ timeout: 15_000 });
    await startGameButton.evaluate((button) => button.click());
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

function assertVisibleHoldSample(sample, expectedPositionPercent) {
  expect(sample.exists).toBe(true);
  expect(sample.display).not.toBe('none');
  expect(sample.visibility).not.toBe('hidden');
  expect(sample.opacity).toBeGreaterThan(0);
  expect(sample.width).toBeGreaterThan(0);
  expect(sample.height).toBeGreaterThan(0);
  expect(sample.buttonExists).toBe(true);
  expect(sample.buttonFollowsHold).toBe(true);
  expect(sample.overlapsButton).toBe(false);
  expect(Math.abs(sample.visiblePositionPercent - expectedPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
}

function assertAuthoritativeTiming(sequence, gesture) {
  const expectedGrade = getExpectedGrade(gesture.pointerDownSnapshot.positionPercent);
  const expectedZone = expectedGrade.toLowerCase();
  const actionPayload = sequence?.action?.payload ?? {};
  const sequencePayload = sequence?.payload ?? {};
  const patch = sequence?.patch ?? {};

  expect(typeof actionPayload.timingPositionPercent).toBe('number');
  expect(Math.abs(Number(actionPayload.timingPositionPercent) - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(actionPayload.rollTimingZone).toBe(expectedZone);
  expect(sequencePayload.timingZone).toBe(expectedZone);
  expect(patch.lastRollTimingZone).toBe(expectedZone);
  expect(gesture.submittedGrade).toBe(expectedGrade);
  expect(gesture.rollLog).toContain('던졌습니다.');
}

async function dispatchPointerDownSnapshotGesture(page, {
  releaseMode = 'inside',
  pointerDownRanges = GOOD_PRESS_RANGES,
  requireAscending = null,
  requireMovingTowardCenter = false,
  holdMs = LONG_PRESS_MS,
  awaitSubmission = true,
} = {}) {
  return page.evaluate(async ({
    releaseMode: requestedReleaseMode,
    pointerDownRanges: targetRanges,
    requireAscending: requiredDirection,
    requireMovingTowardCenter: mustMoveTowardCenter,
    holdMs: requestedHoldMs,
    awaitSubmission: shouldAwaitSubmission,
  }) => {
    const meter = document.querySelector('.roll-timing-live-meter');
    const track = meter?.querySelector('.roll-timing-orb-track');
    const orb = meter?.querySelector('.roll-timing-orb');
    const button = document.querySelector('[data-testid="roll-yut-button"]');
    if (!(meter instanceof HTMLElement) || !(track instanceof HTMLElement) || !(orb instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
      throw new Error('타이밍 막대 또는 던지기 버튼을 찾지 못했습니다.');
    }

    const gradeNames = new Set(['PERFECT', 'NICE', 'GOOD', 'BAD']);
    const readVisiblePositionPercent = (targetMeter = meter, targetOrb = orb) => {
      const meterRect = targetMeter.getBoundingClientRect();
      const orbRect = targetOrb.getBoundingClientRect();
      const meterContentLeft = meterRect.left + targetMeter.clientLeft;
      if (targetMeter.clientWidth <= 0) throw new Error('타이밍 막대 content width가 0입니다.');
      return ((orbRect.left + orbRect.width / 2 - meterContentLeft) / targetMeter.clientWidth) * 100;
    };
    const readSnapshot = (targetMeter = meter) => ({
      positionPercent: Number(targetMeter.dataset.positionPercent),
      phaseMs: Number(targetMeter.dataset.phaseMs),
      capturedAt: Number(targetMeter.dataset.capturedAt),
      resetKey: targetMeter.dataset.resetKey ?? '',
    });
    const waitForCondition = async (condition, timeoutMs, failureMessage) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() <= deadline) {
        const value = condition();
        if (value) return value;
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      throw new Error(failureMessage);
    };
    const waitUntilElapsed = async (startedAt, elapsedMs) => {
      const remainingMs = Math.max(0, startedAt + elapsedMs - performance.now());
      await new Promise((resolve) => window.setTimeout(resolve, remainingMs));
    };
    const waitForRenderedTarget = async () => waitForCondition(() => {
      const snapshot = readSnapshot();
      const inTargetRange = targetRanges.some(([minimum, maximum]) => (
        snapshot.positionPercent >= minimum && snapshot.positionPercent <= maximum
      ));
      const isAscending = snapshot.phaseMs < 1000;
      const matchesDirection = requiredDirection === null || isAscending === requiredDirection;
      const isMovingTowardCenter = snapshot.positionPercent < 50 ? isAscending : !isAscending;
      const matchesCenterDirection = !mustMoveTowardCenter || isMovingTowardCenter;
      return Number.isFinite(snapshot.positionPercent)
        && Number.isFinite(snapshot.phaseMs)
        && inTargetRange
        && matchesDirection
        && matchesCenterDirection
        ? snapshot
        : null;
    }, 3000, `렌더링된 목표 위치를 찾지 못했습니다: ${JSON.stringify(targetRanges)}, ascending=${requiredDirection}, towardCenter=${mustMoveTowardCenter}`);
    const observeSubmission = () => new Promise((resolve, reject) => {
      let submittedGrade = '';
      let rollLog = '';
      const readSubmission = () => {
        if (!submittedGrade) {
          submittedGrade = Array.from(document.querySelectorAll('.roll-timing-feedback, .roll-stage-timing, [role="status"]'))
            .map((element) => element.textContent?.trim() ?? '')
            .find((text) => gradeNames.has(text)) ?? '';
        }
        if (!rollLog) {
          rollLog = Array.from(document.querySelectorAll('.game-log p, aside p, [aria-label="진행 기록"] p'))
            .map((element) => element.textContent?.trim() ?? '')
            .find((text) => text.includes('님이') && text.includes('던졌습니다.')) ?? '';
        }
        if (submittedGrade && rollLog) {
          observer.disconnect();
          window.clearTimeout(timeoutId);
          resolve({ submittedGrade, rollLog });
        }
      };
      const observer = new MutationObserver(readSubmission);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      const timeoutId = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error(`타이밍 제출 관찰 실패: grade=${submittedGrade || '없음'}, log=${rollLog || '없음'}`));
      }, 20_000);
      readSubmission();
    });

    const trackAnimationCount = track.getAnimations().length;
    const targetSnapshot = await waitForRenderedTarget();
    const originalMeterRect = meter.getBoundingClientRect();
    const originalMeterWidth = originalMeterRect.width;
    const originalMeterHeight = originalMeterRect.height;
    const buttonRect = button.getBoundingClientRect();
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
    const pointerId = 23;

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

    const pointerDownSnapshot = readSnapshot();
    const pointerDownVisiblePositionPercent = readVisiblePositionPercent();
    const pointerDownTransform = track.style.transform;
    const pressedAt = performance.now();
    await waitUntilElapsed(pressedAt, requestedHoldMs);
    const heldDuringPressSnapshot = readSnapshot();
    const heldDuringPressVisiblePositionPercent = readVisiblePositionPercent();
    const heldDuringPressTransform = track.style.transform;

    const holdLifecycle = { addedAt: Number.NaN, removedAt: Number.NaN, rollStageVisibleWhileHeld: false };
    const holdSelector = '[data-testid="roll-timing-result-hold"]';
    const holdObserver = new MutationObserver((records) => {
      const observedAt = performance.now();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(holdSelector) || node.querySelector(holdSelector)) {
            if (!Number.isFinite(holdLifecycle.addedAt)) holdLifecycle.addedAt = observedAt;
          }
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(holdSelector) || node.querySelector(holdSelector)) {
            if (!Number.isFinite(holdLifecycle.removedAt)) holdLifecycle.removedAt = observedAt;
          }
        }
      }
      const visibleHold = document.querySelector(holdSelector);
      if (visibleHold?.isConnected && document.querySelector('.roll-stage')) {
        holdLifecycle.rollStageVisibleWhileHeld = true;
      }
    });
    holdObserver.observe(document.body, { childList: true, subtree: true });

    const submissionPromise = shouldAwaitSubmission ? observeSubmission() : null;
    const nativeRandom = Math.random;
    const releasedAt = performance.now();
    let releasedHold = null;
    Math.random = () => 0.9;
    try {
      if (requestedReleaseMode === 'cancel') {
        button.dispatchEvent(new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: 0,
          clientX: buttonCenterX,
          clientY: buttonCenterY,
        }));
      } else {
        const releaseX = requestedReleaseMode === 'inside' ? buttonCenterX : buttonRect.right + 24;
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
        if (requestedReleaseMode === 'inside') {
          releasedHold = await waitForCondition(
            () => document.querySelector(holdSelector),
            1000,
            'pointerup 제출 뒤 정지 결과 막대가 생성되지 않았습니다.',
          );
          await new Promise((resolve) => window.requestAnimationFrame(resolve));
        }
      }
      button.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        detail: 1,
      }));
    } finally {
      Math.random = nativeRandom;
    }

    const resultHold = {
      exists: false,
      parentIsPlayControls: false,
      snapshotPositionPercent: Number.NaN,
      snapshotPhaseMs: Number.NaN,
      widthDeltaPx: Number.NaN,
      heightDeltaPx: Number.NaN,
      rollStageVisible: false,
      rollStageVisibleWhileHeld: false,
      samples: [],
      observerAddedDelayMs: Number.NaN,
      removalDelayMs: Number.NaN,
    };

    if (requestedReleaseMode === 'inside') {
      const heldMeter = releasedHold ?? await waitForCondition(
        () => document.querySelector(holdSelector),
        1000,
        '정지 결과 막대가 생성되지 않았습니다.',
      );
      if (!(heldMeter instanceof HTMLElement)) throw new Error('정지 결과 막대가 HTMLElement가 아닙니다.');
      const heldOrb = heldMeter.querySelector('.roll-timing-orb');
      if (!(heldOrb instanceof HTMLElement)) throw new Error('정지 결과 오브를 찾지 못했습니다.');
      const holdStartedAt = Number(heldMeter.dataset.holdStartedAt);
      if (!Number.isFinite(holdStartedAt)) throw new Error('정지 결과 실제 표시 시작 시각을 찾지 못했습니다.');
      await waitForCondition(
        () => Number.isFinite(holdLifecycle.addedAt),
        1000,
        'MutationObserver가 정지 결과 생성을 감지하지 못했습니다.',
      );

      resultHold.exists = true;
      resultHold.parentIsPlayControls = heldMeter.parentElement?.classList.contains('play-controls') ?? false;
      resultHold.snapshotPositionPercent = Number(heldMeter.dataset.positionPercent);
      resultHold.snapshotPhaseMs = Number(heldMeter.dataset.phaseMs);
      const heldMeterRect = heldMeter.getBoundingClientRect();
      resultHold.widthDeltaPx = Math.abs(heldMeterRect.width - originalMeterWidth);
      resultHold.heightDeltaPx = Math.abs(heldMeterRect.height - originalMeterHeight);
      resultHold.observerAddedDelayMs = holdLifecycle.addedAt - holdStartedAt;

      const sampleHold = (elapsedMs) => {
        const style = window.getComputedStyle(heldMeter);
        const rect = heldMeter.getBoundingClientRect();
        const currentButton = heldMeter.parentElement?.querySelector('button');
        const currentButtonRect = currentButton instanceof HTMLElement ? currentButton.getBoundingClientRect() : null;
        const opacity = Number(style.opacity || 1);
        return {
          elapsedMs,
          exists: heldMeter.isConnected,
          display: style.display,
          visibility: style.visibility,
          opacity: Number.isFinite(opacity) ? opacity : 1,
          width: rect.width,
          height: rect.height,
          visiblePositionPercent: readVisiblePositionPercent(heldMeter, heldOrb),
          rollStageVisible: document.querySelector('.roll-stage') !== null,
          buttonExists: currentButtonRect !== null,
          buttonFollowsHold: Boolean(currentButton && (heldMeter.compareDocumentPosition(currentButton) & Node.DOCUMENT_POSITION_FOLLOWING)),
          overlapsButton: Boolean(currentButtonRect
            && rect.left < currentButtonRect.right
            && rect.right > currentButtonRect.left
            && rect.top < currentButtonRect.bottom
            && rect.bottom > currentButtonRect.top),
        };
      };

      const sampleAt = (elapsedMs) => new Promise((resolve, reject) => {
        const delayMs = Math.max(0, holdStartedAt + elapsedMs - performance.now());
        window.setTimeout(() => {
          try {
            resolve(sampleHold(elapsedMs));
          } catch (error) {
            reject(error);
          }
        }, delayMs);
      });
      resultHold.samples.push(...await Promise.all([0, 500, 900].map(sampleAt)));
      await waitForCondition(
        () => Number.isFinite(holdLifecycle.removedAt),
        1000,
        '정지 결과 막대가 허용 시간 안에 제거되지 않았습니다.',
      );
      resultHold.removalDelayMs = holdLifecycle.removedAt - holdStartedAt;
      resultHold.rollStageVisibleWhileHeld = holdLifecycle.rollStageVisibleWhileHeld
        || resultHold.samples.some((sample) => sample.rollStageVisible);
      await waitForCondition(
        () => document.querySelector('.roll-stage'),
        5000,
        'roll-stage가 생성되지 않았습니다.',
      );
      resultHold.rollStageVisible = true;
    }

    let resumedSnapshot = null;
    let resumedVisiblePositionPercent = Number.NaN;
    let resumedElapsedMs = Number.NaN;
    if (requestedReleaseMode !== 'inside') {
      const resumedSample = await waitForCondition(() => {
        const snapshot = readSnapshot();
        const frameAdvanced = snapshot.capturedAt > pointerDownSnapshot.capturedAt
          && snapshot.phaseMs !== pointerDownSnapshot.phaseMs;
        return frameAdvanced
          ? { snapshot, visiblePositionPercent: readVisiblePositionPercent() }
          : null;
      }, 1000, '취소 뒤 기존 phase에서 rAF 이동이 재개되지 않았습니다.');
      resumedSnapshot = resumedSample.snapshot;
      resumedVisiblePositionPercent = resumedSample.visiblePositionPercent;
      resumedElapsedMs = resumedSnapshot.capturedAt - releasedAt;
    }

    holdObserver.disconnect();
    const submission = submissionPromise ? await submissionPromise : { submittedGrade: '', rollLog: '' };
    return {
      trackAnimationCount,
      targetSnapshot,
      pointerDownSnapshot,
      pointerDownVisiblePositionPercent,
      pointerDownTransform,
      heldDuringPressSnapshot,
      heldDuringPressVisiblePositionPercent,
      heldDuringPressTransform,
      resultHold,
      resumedSnapshot,
      resumedVisiblePositionPercent,
      resumedElapsedMs,
      ...submission,
    };
  }, {
    releaseMode,
    pointerDownRanges,
    requireAscending,
    requireMovingTowardCenter,
    holdMs,
    awaitSubmission,
  });
}

function assertPointerDownFreezeAndHold(gesture) {
  expect(gesture.trackAnimationCount).toBe(0);
  expect(gesture.pointerDownSnapshot).toEqual(gesture.targetSnapshot);
  expect(Math.abs(gesture.pointerDownSnapshot.positionPercent - gesture.pointerDownVisiblePositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(gesture.heldDuringPressSnapshot).toEqual(gesture.pointerDownSnapshot);
  expect(Math.abs(gesture.heldDuringPressVisiblePositionPercent - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(gesture.heldDuringPressTransform).toBe(gesture.pointerDownTransform);
  expect(gesture.resultHold.exists).toBe(true);
  expect(gesture.resultHold.parentIsPlayControls).toBe(true);
  expect(gesture.resultHold.widthDeltaPx).toBeLessThanOrEqual(1);
  expect(gesture.resultHold.heightDeltaPx).toBeLessThanOrEqual(1);
  expect(gesture.resultHold.rollStageVisible).toBe(true);
  expect(gesture.resultHold.rollStageVisibleWhileHeld).toBe(true);
  expect(gesture.resultHold.observerAddedDelayMs).toBeGreaterThanOrEqual(0);
  expect(gesture.resultHold.observerAddedDelayMs).toBeLessThan(250);
  expect(Math.abs(gesture.resultHold.snapshotPositionPercent - gesture.pointerDownSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(Math.abs(gesture.resultHold.snapshotPhaseMs - gesture.pointerDownSnapshot.phaseMs)).toBeLessThanOrEqual(0.001);
  expect(gesture.resultHold.samples).toHaveLength(3);
  for (const sample of gesture.resultHold.samples) {
    assertVisibleHoldSample(sample, gesture.resultHold.snapshotPositionPercent);
  }
  expect(gesture.resultHold.removalDelayMs).toBeGreaterThanOrEqual(1000);
}

function assertCancelledGestureResumes(gesture) {
  expect(gesture.trackAnimationCount).toBe(0);
  expect(gesture.resultHold.exists).toBe(false);
  expect(gesture.submittedGrade).toBe('');
  expect(gesture.rollLog).toBe('');
  expect(gesture.resumedSnapshot).not.toBeNull();
  expect(gesture.resumedElapsedMs).toBeGreaterThan(0);
  expect(gesture.resumedElapsedMs).toBeLessThanOrEqual(1000);
  const phaseDeltaMs = (gesture.resumedSnapshot.phaseMs - gesture.pointerDownSnapshot.phaseMs + ROLL_TIMING_CYCLE_MS) % ROLL_TIMING_CYCLE_MS;
  expect(phaseDeltaMs).toBeGreaterThan(0);
  expect(Math.abs(phaseDeltaMs - gesture.resumedElapsedMs)).toBeLessThanOrEqual(32);
  const expectedPositionPercent = gesture.resumedSnapshot.phaseMs <= ROLL_TIMING_CYCLE_MS / 2
    ? gesture.resumedSnapshot.phaseMs / 10
    : (ROLL_TIMING_CYCLE_MS - gesture.resumedSnapshot.phaseMs) / 10;
  expect(Math.abs(gesture.resumedSnapshot.positionPercent - expectedPositionPercent)).toBeLessThanOrEqual(0.001);
  expect(Math.abs(gesture.resumedVisiblePositionPercent - gesture.resumedSnapshot.positionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
}

async function runAndAssertTimingGesture(page, roomId, options = {}) {
  const beforeSequence = await getLatestSequenceNumber(roomId);
  const gesture = await dispatchPointerDownSnapshotGesture(page, options);
  assertPointerDownFreezeAndHold(gesture);
  const sequence = await waitForRollSequence(roomId, beforeSequence);
  assertAuthoritativeTiming(sequence, gesture);
  return { gesture, sequence };
}

test.describe('mobile roll timing pointerdown snapshot regression', () => {
  test.describe.configure({ mode: POINTER_SPEC_MODE });

  const roomIds = new Set();

  test.beforeEach(() => {
    roomIds.clear();
  });

  test.afterEach(async () => {
    for (const roomId of roomIds) await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('pointerdown Good snapshot은 180ms 뒤 Perfect 시간이 지나도 화면·제출·sequence·최종 판정이 Good으로 일치한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);

    const { gesture } = await runQaStep(testInfo, '실제 렌더된 Good에서 pointerdown 후 Perfect 도달 시간을 지나 pointerup', async () => runAndAssertTimingGesture(page, roomId, {
      pointerDownRanges: GOOD_PRESS_RANGES,
      requireAscending: null,
      requireMovingTowardCenter: true,
      holdMs: LONG_PRESS_MS,
    }));
    expect(GOOD_PRESS_RANGES.some(([minimum, maximum]) => (
      gesture.pointerDownSnapshot.positionPercent >= minimum
      && gesture.pointerDownSnapshot.positionPercent <= maximum
    ))).toBe(true);
    expect(getExpectedGrade(gesture.pointerDownSnapshot.positionPercent)).toBe('GOOD');
    const movementDirection = gesture.pointerDownSnapshot.phaseMs < ROLL_TIMING_CYCLE_MS / 2 ? 1 : -1;
    const hypotheticalPointerUpPosition = gesture.pointerDownSnapshot.positionPercent
      + movementDirection * (LONG_PRESS_MS / 10);
    expect(hypotheticalPointerUpPosition).toBeGreaterThanOrEqual(45);
    expect(hypotheticalPointerUpPosition).toBeLessThanOrEqual(55);
  });

  test('pointerdown Nice snapshot은 오래 눌러도 live freeze·result hold·authoritative 판정이 Nice로 유지된다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);

    const { gesture } = await runQaStep(testInfo, '실제 렌더된 Nice에서 pointerdown 후 180ms 고정과 제출 확인', async () => runAndAssertTimingGesture(page, roomId, {
      pointerDownRanges: NICE_PRESS_RANGES,
      requireAscending: null,
      holdMs: LONG_PRESS_MS,
    }));
    expect(getExpectedGrade(gesture.pointerDownSnapshot.positionPercent)).toBe('NICE');
  });

  test('버튼 밖 pointerup과 pointercancel은 제출하지 않고 기존 phase를 wall-clock 기준으로 연속 재개한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);
    const rollLogLocator = page.locator('.game-log p, aside p, [aria-label="진행 기록"] p').filter({ hasText: '던졌습니다.' });
    const rollLogCountBefore = await rollLogLocator.count();
    const sequenceBefore = await getLatestSequenceNumber(roomId);

    const outsideGesture = await runQaStep(testInfo, '실제 렌더된 Good pointerdown 후 버튼 밖 pointerup과 후속 click', async () => dispatchPointerDownSnapshotGesture(page, {
      releaseMode: 'outside',
      pointerDownRanges: GOOD_CANCEL_RANGES,
      requireAscending: null,
      awaitSubmission: false,
    }));
    assertCancelledGestureResumes(outsideGesture);
    await expect(rollLogLocator).toHaveCount(rollLogCountBefore);
    await expect(page.getByTestId('roll-yut-button')).toBeEnabled();
    await expect.poll(() => getLatestSequenceNumber(roomId), { timeout: 1000, intervals: [100, 200, 300] }).toBe(sequenceBefore);

    const cancelGesture = await runQaStep(testInfo, '같은 방에서 Good pointerdown 후 pointercancel과 후속 click', async () => dispatchPointerDownSnapshotGesture(page, {
      releaseMode: 'cancel',
      pointerDownRanges: GOOD_CANCEL_RANGES,
      requireAscending: null,
      awaitSubmission: false,
    }));
    assertCancelledGestureResumes(cancelGesture);
    await expect(rollLogLocator).toHaveCount(rollLogCountBefore);
    await expect(page.getByTestId('roll-yut-button')).toBeEnabled();
    await expect.poll(() => getLatestSequenceNumber(roomId), { timeout: 1000, intervals: [100, 200, 300] }).toBe(sequenceBefore);
  });

  test('Galaxy viewport에서 pointerdown snapshot과 1초 result hold를 추가 반복 검증한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy timing lane에서만 추가 반복합니다.');
    testInfo.setTimeout(240_000);
    const roomId = await startAiTimingGame(page, context, testInfo, 'repeat-1');
    roomIds.add(roomId);
    await runQaStep(testInfo, 'Galaxy pointerdown snapshot 추가 회귀', async () => runAndAssertTimingGesture(page, roomId, {
      pointerDownRanges: GOOD_PRESS_RANGES,
      requireAscending: null,
      holdMs: LONG_PRESS_MS,
    }));
  });
});
