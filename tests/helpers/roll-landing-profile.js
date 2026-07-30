import { expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from './ui.js';
import { makeQaName, normalizeQaNickname } from './env.js';
import { waitForRoomQaAccess } from './room-access.js';
import { getRoomSequencesForQa } from './rooms.js';

export const ROLL_LANDING_PROFILE_CASES = Object.freeze([
  Object.freeze({ zone: 'perfect', ranges: [[47, 53]], fall: false, countRandom: 0, fallCount: 0, profile: 'centered' }),
  Object.freeze({ zone: 'nice', ranges: [[41, 44]], fall: true, countRandom: 0.99, fallCount: 1, profile: 'centered' }),
  Object.freeze({ zone: 'good', ranges: [[28, 34]], fall: true, countRandom: 0.99, fallCount: 2, profile: 'offset' }),
  Object.freeze({ zone: 'bad', ranges: [[4, 14]], fall: true, countRandom: 0.99, fallCount: 4, profile: 'scattered' }),
]);

async function addAiAndWaitUntilGameCanStart(page) {
  const addAiButton = page.getByTestId('add-ai-P2');
  await expect(addAiButton).toBeVisible({ timeout: 15_000 });
  await expect(addAiButton).toBeEnabled({ timeout: 15_000 });
  await addAiButton.evaluate((button) => button.click());
  await expect(addAiButton).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
}

export async function blockThreeRendererModules(context) {
  await context.route(/https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com)\/.*three(?:@|\/).*three\.module\.js(?:\?.*)?$/u, (route) => route.abort());
}

export async function startRollLandingProfileGame(page, context, testInfo, suffix) {
  const hostName = normalizeQaNickname(makeQaName(testInfo, `landing-${suffix}`));
  const roomTitle = makeQaName(testInfo, `landing-room-${suffix}`);
  await primeLobbyStorage(context, {
    nickname: hostName,
    maxPlayers: '2',
    playMode: 'individual',
    itemMode: 'false',
    pieceCount: '4',
  });
  await context.addInitScript(() => {
    window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
    window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
  });

  let roomId;
  await runQaStep(testInfo, `${suffix} 등급 실제 AI 게임 시작`, async () => {
    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await addAiAndWaitUntilGameCanStart(page);
    await page.getByTestId('start-game-button').evaluate((button) => button.click());
    await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    await expect.poll(async () => {
      const state = await collectScreenState(page);
      const debug = state.yutDebug ?? {};
      const turnOrderReady = Array.isArray(debug.turnOrderIds) && debug.turnOrderIds.length >= 2
        && !debug.turnOrderPhase?.active && !debug.turnOrderIntro
        && !state.turnOrder.phaseOverlayVisible && !state.turnOrder.introOverlayVisible && !state.turnOrder.lockVisible;
      return turnOrderReady && state.rollButton.visible && !state.rollButton.disabled ? 'ready' : JSON.stringify(state, null, 2);
    }, { timeout: 40_000, message: '고정 순서 정하기 완료 후 사용자 윷 던지기가 활성화되어야 합니다.' }).toBe('ready');
  });
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

async function clickTimingZoneWithRandom(page, profileCase) {
  return page.evaluate(({ ranges, fall, countRandom }) => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const sample = () => {
      const meter = document.querySelector('.roll-timing-live-meter, .roll-timing-meter');
      const orb = meter?.querySelector('.roll-timing-orb');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (meter instanceof HTMLElement && orb instanceof HTMLElement && button instanceof HTMLButtonElement && !button.disabled) {
        const meterRect = meter.getBoundingClientRect();
        const orbRect = orb.getBoundingClientRect();
        const positionPercent = meter.clientWidth > 0
          ? ((orbRect.left + orbRect.width / 2 - meterRect.left - meter.clientLeft) / meter.clientWidth) * 100
          : -1;
        const inTargetRange = ranges.some(([minimum, maximum]) => positionPercent >= minimum && positionPercent <= maximum);
        if (inTargetRange) {
          const originalRandom = Math.random;
          const values = [0.1, 0.9, 0.9, 0.9, fall ? 0 : 0.999999, countRandom, 0.42, 0.73];
          let index = 0;
          Math.random = () => values[index++] ?? originalRandom();
          try {
            button.click();
          } finally {
            Math.random = originalRandom;
          }
          resolve({ positionPercent, randomValuesUsed: index });
          return;
        }
      }
      if (performance.now() - startedAt > 12_000) {
        reject(new Error(`12초 동안 목표 타이밍 구간을 찾지 못했습니다: ${JSON.stringify(ranges)}`));
        return;
      }
      requestAnimationFrame(sample);
    };
    sample();
  }), profileCase);
}

export async function verifyRollLandingProfile(page, roomId, testInfo, profileCase, expectedRenderer) {
  const previousSequence = await getLatestSequenceNumber(roomId);
  await runQaStep(testInfo, `${profileCase.zone} 타이밍 실제 던지기`, async () => {
    const clickResult = await clickTimingZoneWithRandom(page, profileCase);
    expect(clickResult.positionPercent).toBeGreaterThanOrEqual(profileCase.ranges[0][0]);
    expect(clickResult.positionPercent).toBeLessThanOrEqual(profileCase.ranges[0][1]);
    expect(clickResult.randomValuesUsed).toBeGreaterThanOrEqual(profileCase.fall ? 7 : 6);
  });

  const scene = page.getByTestId('yut-roll-scene');
  await runQaStep(testInfo, `${profileCase.zone} 렌더러 착지 프로필과 낙 개수 확인`, async () => {
    await expect(scene, `실제 윷 애니메이션 장면이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 8_000 });
    await expect(scene).toHaveAttribute('data-timing-zone', profileCase.zone);
    await expect(scene).toHaveAttribute('data-landing-profile', profileCase.profile);
    await expect(scene).toHaveAttribute('data-fall-count', String(profileCase.fallCount));
    await expect(scene).toHaveAttribute('data-renderer', expectedRenderer, { timeout: 12_000 });
    await expect(scene.locator('.yut-stick[data-fallen="true"]')).toHaveCount(profileCase.fallCount);
    await expect(scene.locator('.yut-stick[data-fallen="false"]')).toHaveCount(4 - profileCase.fallCount);
  });

  await runQaStep(testInfo, `${profileCase.zone} authoritative payload 확인`, async () => {
    const sequence = await waitForRollSequence(roomId, previousSequence);
    const actionPayload = sequence?.action?.payload ?? {};
    const sequencePayload = sequence?.payload ?? {};
    expect(actionPayload.rollTimingZone).toBe(profileCase.zone);
    expect(actionPayload.clientFallOccurred).toBe(profileCase.fall);
    expect(Number(actionPayload.clientFallCount ?? 0)).toBe(profileCase.fallCount);
    expect(sequencePayload.timingZone).toBe(profileCase.zone);
    expect(Number(sequencePayload.fallCount ?? 0)).toBe(profileCase.fallCount);
  });
}
