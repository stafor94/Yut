import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, getRoomSequencesForQa, rememberRoomIdFromPage } from '../helpers/rooms.js';

const GOOD_PRESS_RANGE = Object.freeze([32, 36]);
const NICE_RELEASE_RANGE = Object.freeze([58, 59.5]);
const GOOD_RELEASE_RANGE = Object.freeze([68, 72]);
const PERFECT_RELEASE_RANGE = Object.freeze([48, 52]);
const POSITION_TOLERANCE_PERCENT = 0.15;
const HOLD_REMOVAL_MAX_DELAY_MS = 1500;

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

  // This is setup for the timing gesture assertions below. WebKit can keep the
  // mobile waiting-room card in sub-pixel layout motion long enough for
  // Playwright's pointer actionability stability check to time out even though
  // the visible, enabled button is ready. Trigger the same DOM click handler,
  // then retain the user-visible state assertions as the completion condition.
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
    await expect.poll(async () => {
      resolvedRoomId = await rememberRoomIdFromPage(page).catch(() => undefined);
      return resolvedRoomId ?? '';
    }, { timeout: 5_000, message: '생성된 방의 Firebase Auth 토큰과 QA cleanup 권한이 준비되어야 합니다.' }).not.toBe('');
    resolvedRoomId ??= await findRoomIdByTitle(roomTitle);
    await addAiAndWaitUntilGameCanStart(page);
    const startGameButton = page.getByTestId('start-game-button');
    await expect(startGameButton).toBeVisible({ timeout: 15_000 });
    await expect(startGameButton).toBeEnabled({ timeout: 15_000 });
    // The timing gesture is the behavior under test. WebKit can keep the waiting-room
    // action bar in sub-pixel motion, so use the same DOM setup click as the AI button
    // and keep the game-screen and turn-order assertions as completion conditions.
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
  expect(sample.overlapsButton).toBe(false);
  expect(Math.abs(sample.visiblePositionPercent - expectedPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
}

function assertAuthoritativeTiming(sequence, gesture) {
  const expectedGrade = getExpectedGrade(gesture.pointerUpPositionPercent);
  const expectedZone = expectedGrade.toLowerCase();
  const actionPayload = sequence?.action?.payload ?? {};
  const sequencePayload = sequence?.payload ?? {};
  const patch = sequence?.patch ?? {};
  const stateAfter = sequence?.stateAfter ?? {};

  expect(typeof actionPayload.timingPositionPercent).toBe('number');
  expect(Math.abs(Number(actionPayload.timingPositionPercent) - gesture.pointerUpPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(actionPayload.rollTimingZone).toBe(expectedZone);
  expect(sequencePayload.timingZone).toBe(expectedZone);
  expect(patch.lastRollTimingZone ?? stateAfter.lastRollTimingZone).toBe(expectedZone);
  expect(stateAfter.lastRollTimingZone).toBe(expectedZone);
  expect(gesture.submittedGrade).toBe(expectedGrade);
  expect(gesture.rollLog).toContain('던졌습니다.');
}

async function dispatchVisibleTimingGesture(page, {
  releaseInside = true,
  pointerDownRange = GOOD_PRESS_RANGE,
  pointerUpRange = NICE_RELEASE_RANGE,
  staleRenderedRange = PERFECT_RELEASE_RANGE,
  reportedAnimationCurrentTime,
  awaitSubmission = true,
} = {}) {
  return page.evaluate(async ({
    releaseInside: shouldReleaseInside,
    pointerDownRange: downRange,
    pointerUpRange: upRange,
    staleRenderedRange: staleRange,
    reportedAnimationCurrentTime: forcedCurrentTime,
    awaitSubmission: shouldAwaitSubmission,
  }) => {
    const meter = document.querySelector('.roll-timing-live-meter');
    const track = meter?.querySelector('.roll-timing-orb-track');
    const orb = meter?.querySelector('.roll-timing-orb');
    const button = document.querySelector('[data-testid="roll-yut-button"]');
    if (!(meter instanceof HTMLElement) || !(track instanceof HTMLElement) || !(orb instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
      throw new Error('타이밍 막대 또는 던지기 버튼을 찾지 못했습니다.');
    }
    const animation = track.getAnimations()[0];
    if (!animation) throw new Error('타이밍 orb track animation을 찾지 못했습니다.');

    const computedTiming = animation.effect?.getComputedTiming();
    const iterationDuration = Number(computedTiming?.duration);
    if (!Number.isFinite(iterationDuration) || iterationDuration <= 0) {
      throw new Error(`타이밍 animation duration을 확인하지 못했습니다: ${String(computedTiming?.duration)}`);
    }
    await animation.ready;
    animation.pause();

    const gradeNames = new Set(['PERFECT', 'NICE', 'GOOD', 'BAD']);
    const readPositionPercent = (targetMeter = meter, targetOrb = orb) => {
      const meterRect = targetMeter.getBoundingClientRect();
      const orbRect = targetOrb.getBoundingClientRect();
      return ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100;
    };
    const waitForRenderedFrame = () => new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
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
      await waitForCondition(
        () => performance.now() - startedAt >= elapsedMs,
        elapsedMs + 500,
        `${elapsedMs}ms 관측 시점에 도달하지 못했습니다.`,
      );
    };
    const placeAtVisiblePosition = (minimum, maximum) => {
      let lowerTime = 0;
      let upperTime = iterationDuration;
      let positionPercent = readPositionPercent();
      for (let attempt = 0; attempt < 18; attempt += 1) {
        const candidateTime = (lowerTime + upperTime) / 2;
        animation.currentTime = candidateTime;
        positionPercent = readPositionPercent();
        if (positionPercent >= minimum && positionPercent <= maximum) return positionPercent;
        if (positionPercent < minimum) lowerTime = candidateTime;
        else upperTime = candidateTime;
      }
      throw new Error(`화면 타이밍 위치 설정 실패: target=${minimum}-${maximum}, actual=${positionPercent}`);
    };
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

    placeAtVisiblePosition(staleRange[0], staleRange[1]);
    await waitForRenderedFrame();
    const staleRenderedPositionPercent = readPositionPercent();

    const pointerDownPositionPercent = placeAtVisiblePosition(downRange[0], downRange[1]);
    const buttonRect = button.getBoundingClientRect();
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
    const releaseX = shouldReleaseInside ? buttonCenterX : buttonRect.right + 24;
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

    // Move the compositor-visible animation after the last rAF sample, then release in
    // the same JavaScript task. The old rAF-authoritative implementation submits the
    // stale Perfect sample, while the input-event freeze path reads this visible value.
    placeAtVisiblePosition(upRange[0], upRange[1]);
    const pointerUpPositionPercent = readPositionPercent();
    const originalMeterWidth = meter.getBoundingClientRect().width;
    let animationCurrentTime = Number(animation.currentTime);
    if (typeof forcedCurrentTime === 'number') {
      animationCurrentTime = forcedCurrentTime;
      const reportedAnimation = {
        get currentTime() { return forcedCurrentTime; },
        get effect() { return animation.effect; },
        cancel: () => animation.cancel(),
        pause: () => animation.pause(),
      };
      Object.defineProperty(track, 'getAnimations', {
        configurable: true,
        value: () => [reportedAnimation],
      });
    }

    const holdLifecycle = {
      createdAt: Number.NaN,
      removedAt: Number.NaN,
    };
    const holdSelector = '[data-testid="roll-timing-result-hold"]';
    const holdObserver = new MutationObserver((records) => {
      const observedAt = performance.now();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(holdSelector) || node.querySelector(holdSelector)) {
            if (!Number.isFinite(holdLifecycle.createdAt)) holdLifecycle.createdAt = observedAt;
          }
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(holdSelector) || node.querySelector(holdSelector)) {
            if (!Number.isFinite(holdLifecycle.removedAt)) holdLifecycle.removedAt = observedAt;
          }
        }
      }
    });
    holdObserver.observe(document.body, { childList: true, subtree: true });

    const submissionPromise = shouldAwaitSubmission ? observeSubmission() : null;
    const nativeRandom = Math.random;
    Math.random = () => 0.9;
    try {
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
    } finally {
      Math.random = nativeRandom;
    }

    const frozenOriginalPositionPercent = readPositionPercent();
    const frozenOriginalTransform = window.getComputedStyle(track).transform;
    const resultHold = {
      exists: false,
      parentIsPlayControls: false,
      insertedBeforeButton: false,
      snapshotPositionPercent: Number.NaN,
      widthDeltaPx: Number.NaN,
      rollStageVisible: false,
      samples: [],
      removalDelayMs: Number.NaN,
    };

    if (shouldReleaseInside) {
      const heldMeter = await waitForCondition(
        () => document.querySelector(holdSelector),
        1000,
        '정지 결과 막대가 생성되지 않았습니다.',
      );
      if (!(heldMeter instanceof HTMLElement)) throw new Error('정지 결과 막대가 HTMLElement가 아닙니다.');
      const heldOrb = heldMeter.querySelector('.roll-timing-orb');
      if (!(heldOrb instanceof HTMLElement)) throw new Error('정지 결과 오브를 찾지 못했습니다.');
      if (!Number.isFinite(holdLifecycle.createdAt)) holdLifecycle.createdAt = performance.now();

      resultHold.exists = true;
      resultHold.parentIsPlayControls = heldMeter.parentElement?.classList.contains('play-controls') ?? false;
      resultHold.insertedBeforeButton = heldMeter.nextElementSibling === button;
      resultHold.snapshotPositionPercent = Number(heldMeter.dataset.positionPercent);
      resultHold.widthDeltaPx = Math.abs(heldMeter.getBoundingClientRect().width - originalMeterWidth);

      await waitForCondition(
        () => document.querySelector('.roll-stage'),
        5000,
        'roll-stage가 생성되지 않았습니다.',
      );
      resultHold.rollStageVisible = true;

      const sampleHold = (elapsedMs) => {
        const style = window.getComputedStyle(heldMeter);
        const rect = heldMeter.getBoundingClientRect();
        const orbRect = heldOrb.getBoundingClientRect();
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
          visiblePositionPercent: ((orbRect.left + orbRect.width / 2 - rect.left) / rect.width) * 100,
          overlapsButton: Boolean(currentButtonRect
            && rect.left < currentButtonRect.right
            && rect.right > currentButtonRect.left
            && rect.top < currentButtonRect.bottom
            && rect.bottom > currentButtonRect.top),
        };
      };

      resultHold.samples.push(sampleHold(0));
      await waitUntilElapsed(holdLifecycle.createdAt, 500);
      resultHold.samples.push(sampleHold(500));
      await waitUntilElapsed(holdLifecycle.createdAt, 900);
      resultHold.samples.push(sampleHold(900));
      await waitForCondition(
        () => Number.isFinite(holdLifecycle.removedAt) || !heldMeter.isConnected,
        1000,
        '정지 결과 막대가 허용 시간 안에 제거되지 않았습니다.',
      );
      if (!Number.isFinite(holdLifecycle.removedAt)) holdLifecycle.removedAt = performance.now();
      resultHold.removalDelayMs = holdLifecycle.removedAt - holdLifecycle.createdAt;
    }

    holdObserver.disconnect();
    const submission = submissionPromise ? await submissionPromise : { submittedGrade: '', rollLog: '' };
    return {
      staleRenderedPositionPercent,
      pointerDownPositionPercent,
      pointerUpPositionPercent,
      frozenOriginalPositionPercent,
      frozenOriginalTransform,
      animationCurrentTime,
      resultHold,
      ...submission,
    };
  }, {
    releaseInside,
    pointerDownRange,
    pointerUpRange,
    staleRenderedRange,
    reportedAnimationCurrentTime,
    awaitSubmission,
  });
}

function assertFrozenSnapshotAndHold(gesture) {
  expect(gesture.staleRenderedPositionPercent).toBeGreaterThanOrEqual(PERFECT_RELEASE_RANGE[0]);
  expect(gesture.staleRenderedPositionPercent).toBeLessThanOrEqual(PERFECT_RELEASE_RANGE[1]);
  expect(Math.abs(gesture.frozenOriginalPositionPercent - gesture.pointerUpPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(gesture.frozenOriginalTransform).not.toBe('none');
  expect(gesture.resultHold.exists).toBe(true);
  expect(gesture.resultHold.parentIsPlayControls).toBe(true);
  expect(gesture.resultHold.insertedBeforeButton).toBe(true);
  expect(gesture.resultHold.widthDeltaPx).toBeLessThanOrEqual(1);
  expect(gesture.resultHold.rollStageVisible).toBe(true);
  expect(Math.abs(gesture.resultHold.snapshotPositionPercent - gesture.pointerUpPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
  expect(gesture.resultHold.samples).toHaveLength(3);
  for (const sample of gesture.resultHold.samples) {
    assertVisibleHoldSample(sample, gesture.resultHold.snapshotPositionPercent);
  }
  expect(gesture.resultHold.removalDelayMs).toBeGreaterThanOrEqual(1000);
  expect(gesture.resultHold.removalDelayMs).toBeLessThanOrEqual(HOLD_REMOVAL_MAX_DELAY_MS);
}

async function runAndAssertTimingGesture(page, roomId, options = {}) {
  const beforeSequence = await getLatestSequenceNumber(roomId);
  const gesture = await dispatchVisibleTimingGesture(page, options);
  assertFrozenSnapshotAndHold(gesture);
  const sequence = await waitForRollSequence(roomId, beforeSequence);
  assertAuthoritativeTiming(sequence, gesture);
  return { gesture, sequence };
}

test.describe('mobile roll timing release regression', () => {
  const roomIds = new Set();

  test.beforeEach(() => {
    roomIds.clear();
  });

  test.afterEach(async () => {
    for (const roomId of roomIds) await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('애니메이션 시간은 Perfect여도 화면 구슬이 Nice이면 화면 기준으로 Nice 판정한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);

    const { gesture } = await runQaStep(testInfo, 'stale rAF는 Perfect이고 합성 화면은 Nice인 상태를 새 rAF 없이 제출', async () => runAndAssertTimingGesture(page, roomId, {
      pointerUpRange: NICE_RELEASE_RANGE,
      reportedAnimationCurrentTime: 500,
    }));
    expect(gesture.animationCurrentTime).toBe(500);
    expect(gesture.pointerUpPositionPercent).toBeGreaterThanOrEqual(NICE_RELEASE_RANGE[0]);
    expect(gesture.pointerUpPositionPercent).toBeLessThanOrEqual(NICE_RELEASE_RANGE[1]);
  });

  test('stale rAF가 Perfect여도 화면 구슬이 Good이면 화면·제출·sequence·최종 판정이 Good으로 일치한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);

    const { gesture } = await runQaStep(testInfo, 'stale rAF는 Perfect이고 합성 화면은 Good인 상태를 새 rAF 없이 제출', async () => runAndAssertTimingGesture(page, roomId, {
      pointerUpRange: GOOD_RELEASE_RANGE,
    }));
    expect(gesture.pointerUpPositionPercent).toBeGreaterThanOrEqual(GOOD_RELEASE_RANGE[0]);
    expect(gesture.pointerUpPositionPercent).toBeLessThanOrEqual(GOOD_RELEASE_RANGE[1]);
  });

  test('터치 시작이 Good이어도 손을 뗀 화면 위치가 Perfect이면 Perfect로 판정한다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);

    const beforeSequence = await getLatestSequenceNumber(roomId);
    const gesture = await runQaStep(testInfo, '화면 Good에서 누르고 Perfect에서 손을 뗀 좌표와 등급 확인', async () => dispatchVisibleTimingGesture(page, {
      pointerUpRange: PERFECT_RELEASE_RANGE,
      staleRenderedRange: GOOD_RELEASE_RANGE,
    }));
    expect(gesture.pointerDownPositionPercent).toBeGreaterThanOrEqual(GOOD_PRESS_RANGE[0]);
    expect(gesture.pointerDownPositionPercent).toBeLessThanOrEqual(GOOD_PRESS_RANGE[1]);
    expect(gesture.pointerUpPositionPercent).toBeGreaterThanOrEqual(PERFECT_RELEASE_RANGE[0]);
    expect(gesture.pointerUpPositionPercent).toBeLessThanOrEqual(PERFECT_RELEASE_RANGE[1]);
    expect(gesture.submittedGrade).toBe('PERFECT');
    const sequence = await waitForRollSequence(roomId, beforeSequence);
    assertAuthoritativeTiming(sequence, gesture);
  });

  test('버튼 밖으로 손을 떼면 브라우저 후속 click이 발생해도 던지지 않는다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(180_000);
    const roomId = await startAiTimingGame(page, context, testInfo);
    roomIds.add(roomId);
    const rollLogLocator = page.locator('.game-log p, aside p, [aria-label="진행 기록"] p').filter({ hasText: '던졌습니다.' });
    const rollLogCountBefore = await rollLogLocator.count();
    const sequenceBefore = await getLatestSequenceNumber(roomId);

    await runQaStep(testInfo, '화면 Perfect 위치에서 버튼 밖 release와 후속 click 입력', async () => {
      await dispatchVisibleTimingGesture(page, { releaseInside: false, pointerUpRange: PERFECT_RELEASE_RANGE, awaitSubmission: false });
    });

    await runQaStep(testInfo, '취소된 입력이 roll을 제출하지 않았는지 확인', async () => {
      await expect(rollLogLocator).toHaveCount(rollLogCountBefore);
      await expect(page.getByTestId('roll-yut-button')).toBeVisible();
      await expect(page.getByTestId('roll-yut-button')).toBeEnabled();
      await expect.poll(() => getLatestSequenceNumber(roomId), { timeout: 1000, intervals: [100, 200, 300] }).toBe(sequenceBefore);
    });
  });

  test('Galaxy viewport에서 stale rAF Nice·Good 시나리오를 3회 반복해 동일 snapshot과 1초 정지를 유지한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy timing lane에서만 3회 반복합니다.');
    testInfo.setTimeout(420_000);
    const attempts = [NICE_RELEASE_RANGE, GOOD_RELEASE_RANGE, NICE_RELEASE_RANGE];

    for (const [index, pointerUpRange] of attempts.entries()) {
      const roomId = await startAiTimingGame(page, context, testInfo, `repeat-${index + 1}`);
      roomIds.add(roomId);
      await runQaStep(testInfo, `Galaxy stale rAF 회귀 ${index + 1}/3`, async () => runAndAssertTimingGesture(page, roomId, { pointerUpRange }));
      await deleteRoomForQa(roomId).catch(() => undefined);
      roomIds.delete(roomId);
      await page.goto('/Yut/', { waitUntil: 'domcontentloaded' });
    }
  });
});
