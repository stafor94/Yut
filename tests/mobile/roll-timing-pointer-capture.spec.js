import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const GOOD_PRESS_RANGE = Object.freeze([34, 39]);
const NICE_RELEASE_RANGE = Object.freeze([40.5, 44.5]);
const PERFECT_RELEASE_RANGE = Object.freeze([46, 54]);

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
    await expect.poll(async () => {
      resolvedRoomId = await rememberRoomIdFromPage(page).catch(() => undefined);
      return resolvedRoomId ?? '';
    }, { timeout: 5_000, message: '생성된 방의 Firebase Auth 토큰과 QA cleanup 권한이 준비되어야 합니다.' }).not.toBe('');
    resolvedRoomId ??= await findRoomIdByTitle(roomTitle);
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

async function dispatchVisibleTimingGesture(page, {
  releaseInside = true,
  pointerDownRange = GOOD_PRESS_RANGE,
  pointerUpRange = NICE_RELEASE_RANGE,
  reportedAnimationCurrentTime,
  awaitSubmission = true,
} = {}) {
  return page.evaluate(async ({
    releaseInside: shouldReleaseInside,
    pointerDownRange: downRange,
    pointerUpRange: upRange,
    reportedAnimationCurrentTime: forcedCurrentTime,
    awaitSubmission: shouldAwaitSubmission,
  }) => {
    const meter = document.querySelector('.roll-timing-meter');
    const track = document.querySelector('.roll-timing-orb-track');
    const orb = document.querySelector('.roll-timing-orb');
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

    const gradeNames = new Set(['PERFECT', 'NICE', 'GOOD', 'BAD']);
    const readPositionPercent = () => {
      const meterRect = meter.getBoundingClientRect();
      const orbRect = orb.getBoundingClientRect();
      return ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100;
    };
    const placeAtVisiblePosition = (minimum, maximum) => {
      animation.pause();
      let lowerTime = 0;
      let upperTime = iterationDuration;
      let positionPercent = readPositionPercent();
      for (let attempt = 0; attempt < 16; attempt += 1) {
        animation.currentTime = (lowerTime + upperTime) / 2;
        positionPercent = readPositionPercent();
        if (positionPercent >= minimum && positionPercent <= maximum) return positionPercent;
        if (positionPercent < minimum) lowerTime = Number(animation.currentTime);
        else upperTime = Number(animation.currentTime);
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

    const pointerUpPositionPercent = placeAtVisiblePosition(upRange[0], upRange[1]);
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

    const submissionPromise = shouldAwaitSubmission ? observeSubmission() : null;
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

    const submission = submissionPromise ? await submissionPromise : { submittedGrade: '', rollLog: '' };
    return {
      pointerDownPositionPercent,
      pointerUpPositionPercent,
      animationCurrentTime,
      ...submission,
    };
  }, {
    releaseInside,
    pointerDownRange,
    pointerUpRange,
    reportedAnimationCurrentTime,
    awaitSubmission,
  });
}

test.describe('mobile roll timing release regression', () => {
  let roomId;

  test.beforeEach(() => {
    roomId = undefined;
  });

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('애니메이션 시간은 Perfect여도 화면 구슬이 Nice이면 화면 기준으로 Nice 판정한다', async ({ page, context }, testInfo) => {
    roomId = await startAiTimingGame(page, context, testInfo);

    const sampledPositions = await runQaStep(testInfo, '화면은 Nice이고 보고된 animation timeline은 Perfect인 상태 제출', async () => dispatchVisibleTimingGesture(page, {
      reportedAnimationCurrentTime: 500,
    }));
    expect(sampledPositions.animationCurrentTime).toBe(500);
    expect(sampledPositions.pointerUpPositionPercent).toBeGreaterThanOrEqual(NICE_RELEASE_RANGE[0]);
    expect(sampledPositions.pointerUpPositionPercent).toBeLessThanOrEqual(NICE_RELEASE_RANGE[1]);
    expect(sampledPositions.submittedGrade).toBe('NICE');
    expect(sampledPositions.rollLog).toContain('던졌습니다.');
  });

  test('화면 구슬을 Nice 위치로 이동해 놓으면 화면과 동일하게 Nice로 판정한다', async ({ page, context }, testInfo) => {
    roomId = await startAiTimingGame(page, context, testInfo);

    const sampledPositions = await runQaStep(testInfo, '화면 Good 위치에서 누르고 Nice 위치에서 손을 뗀 좌표와 등급 확인', async () => dispatchVisibleTimingGesture(page));
    expect(sampledPositions.pointerDownPositionPercent).toBeGreaterThanOrEqual(GOOD_PRESS_RANGE[0]);
    expect(sampledPositions.pointerDownPositionPercent).toBeLessThanOrEqual(GOOD_PRESS_RANGE[1]);
    expect(sampledPositions.pointerUpPositionPercent).toBeGreaterThanOrEqual(NICE_RELEASE_RANGE[0]);
    expect(sampledPositions.pointerUpPositionPercent).toBeLessThanOrEqual(NICE_RELEASE_RANGE[1]);
    expect(sampledPositions.submittedGrade).toBe('NICE');
    expect(sampledPositions.rollLog).toContain('던졌습니다.');
  });

  test('터치 시작이 Good이어도 손을 뗀 화면 위치가 Perfect이면 Perfect로 판정한다', async ({ page, context }, testInfo) => {
    roomId = await startAiTimingGame(page, context, testInfo);

    const sampledPositions = await runQaStep(testInfo, '화면 Good에서 누르고 Perfect에서 손을 뗀 좌표와 등급 확인', async () => dispatchVisibleTimingGesture(page, {
      pointerUpRange: PERFECT_RELEASE_RANGE,
    }));
    expect(sampledPositions.pointerDownPositionPercent).toBeGreaterThanOrEqual(GOOD_PRESS_RANGE[0]);
    expect(sampledPositions.pointerDownPositionPercent).toBeLessThanOrEqual(GOOD_PRESS_RANGE[1]);
    expect(sampledPositions.pointerUpPositionPercent).toBeGreaterThanOrEqual(PERFECT_RELEASE_RANGE[0]);
    expect(sampledPositions.pointerUpPositionPercent).toBeLessThanOrEqual(PERFECT_RELEASE_RANGE[1]);
    expect(sampledPositions.submittedGrade).toBe('PERFECT');
    expect(sampledPositions.rollLog).toContain('던졌습니다.');
  });

  test('버튼 밖으로 손을 떼면 브라우저 후속 click이 발생해도 던지지 않는다', async ({ page, context }, testInfo) => {
    roomId = await startAiTimingGame(page, context, testInfo);
    const rollLogLocator = page.locator('.game-log p, aside p, [aria-label="진행 기록"] p').filter({ hasText: '던졌습니다.' });
    const rollLogCountBefore = await rollLogLocator.count();

    await runQaStep(testInfo, '화면 Perfect 위치에서 버튼 밖 release와 후속 click 입력', async () => {
      await dispatchVisibleTimingGesture(page, { releaseInside: false, pointerUpRange: PERFECT_RELEASE_RANGE, awaitSubmission: false });
      await page.waitForTimeout(500);
    });

    await runQaStep(testInfo, '취소된 입력이 roll을 제출하지 않았는지 확인', async () => {
      await expect(rollLogLocator).toHaveCount(rollLogCountBefore);
      await expect(page.getByTestId('roll-yut-button')).toBeVisible();
      await expect(page.getByTestId('roll-yut-button')).toBeEnabled();
    });
  });
});
