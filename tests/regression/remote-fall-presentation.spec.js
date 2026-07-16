import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const MOBILE_VIEWPORT = { width: 412, height: 915 };
const REMOTE_RENDERER_FRAME_DELAY_MS = 4_000;
const REMOTE_RENDERER_DELAY_STYLE_ID = 'yut-qa-remote-renderer-delay';

async function findActiveRoller(entries) {
  for (const entry of entries) {
    const button = entry.page.getByTestId('roll-yut-button');
    if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) return entry;
  }
  return null;
}

async function clickForcedFall(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const sample = () => {
      const meter = document.querySelector('.roll-timing-meter');
      const orb = document.querySelector('.roll-timing-orb');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      if (meter && orb && button instanceof HTMLButtonElement && !button.disabled) {
        const meterRect = meter.getBoundingClientRect();
        const orbRect = orb.getBoundingClientRect();
        const positionPercent = meterRect.width > 0
          ? ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100
          : -1;
        if (positionPercent >= 0 && (positionPercent <= 25 || positionPercent >= 75)) {
          const originalRandom = Math.random;
          const values = [0.1, 0.9, 0.9, 0.9, 0, 0.76, 0.42];
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
        reject(new Error('12초 동안 Normal 구간에서 낙 강제 윷 던지기를 실행하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    sample();
  }));
}

async function delayAnimationFrames(page, delayMs) {
  await page.evaluate(({ nextDelayMs, styleId }) => {
    if (!window.__YUT_QA_ORIGINAL_REQUEST_ANIMATION_FRAME__) {
      window.__YUT_QA_ORIGINAL_REQUEST_ANIMATION_FRAME__ = window.requestAnimationFrame.bind(window);
      window.__YUT_QA_ORIGINAL_CANCEL_ANIMATION_FRAME__ = window.cancelAnimationFrame.bind(window);
    }
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), nextDelayMs);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `.yut-roll-scene[data-renderer='fallback'] .yut-stick { animation-duration: ${nextDelayMs}ms !important; }`;
    document.head.append(style);
  }, { nextDelayMs: delayMs, styleId: REMOTE_RENDERER_DELAY_STYLE_ID });
}

async function restoreAnimationFrames(page) {
  await page.evaluate((styleId) => {
    document.getElementById(styleId)?.remove();
    if (window.__YUT_QA_ORIGINAL_REQUEST_ANIMATION_FRAME__) {
      window.requestAnimationFrame = window.__YUT_QA_ORIGINAL_REQUEST_ANIMATION_FRAME__;
      window.cancelAnimationFrame = window.__YUT_QA_ORIGINAL_CANCEL_ANIMATION_FRAME__;
      delete window.__YUT_QA_ORIGINAL_REQUEST_ANIMATION_FRAME__;
      delete window.__YUT_QA_ORIGINAL_CANCEL_ANIMATION_FRAME__;
    }
  }, REMOTE_RENDERER_DELAY_STYLE_ID).catch(() => undefined);
}

async function startFallTimingObservation(page) {
  await page.evaluate(() => {
    window.__YUT_QA_REMOTE_FALL_OBSERVER__?.disconnect();
    const timing = { stageStartedAt: 0, labelStartedAt: 0, endedAt: 0 };
    window.__YUT_QA_REMOTE_FALL_TIMING__ = timing;
    const sample = () => {
      const stage = document.querySelector('.roll-stage');
      const fallMat = document.querySelector('.roll-stage .roll-mat.fall-roll');
      const label = document.querySelector('.roll-stage .roll-label');
      const now = performance.now();
      if (stage && fallMat && timing.stageStartedAt === 0) timing.stageStartedAt = now;
      if (label && label.textContent?.trim() === '낙!' && timing.labelStartedAt === 0) timing.labelStartedAt = now;
      if (!stage && timing.stageStartedAt > 0 && timing.endedAt === 0) {
        timing.endedAt = now;
        window.__YUT_QA_REMOTE_FALL_OBSERVER__?.disconnect();
      }
    };
    const observer = new MutationObserver(sample);
    window.__YUT_QA_REMOTE_FALL_OBSERVER__ = observer;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-settle-source'] });
    sample();
  });
}

test.describe('remote fall presentation QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('상대 플레이어 낙은 렌더러 완료 전 종료되지 않고 상단 전체 턴 정보를 유지한다', async ({ page: hostPage, context: hostContext, browser }, testInfo) => {
    testInfo.setTimeout(180_000);
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'fall-host'));
    const guestName = normalizeQaNickname(makeQaName(testInfo, 'fall-guest'));
    const roomTitle = makeQaName(testInfo, 'fall-room');
    const guestContext = await browser.newContext();
    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    const guestPage = await guestContext.newPage();
    await hostPage.setViewportSize(MOBILE_VIEWPORT);
    await guestPage.setViewportSize(MOBILE_VIEWPORT);

    try {
      await runQaStep(testInfo, '실제 2인 온라인 방 시작', async () => {
        await expectAppShell(hostPage);
        await hostPage.getByTestId('room-title-input').fill(roomTitle);
        await hostPage.getByTestId('create-room-button').click();
        await expect(hostPage.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
        roomId = await rememberRoomIdFromPage(hostPage) ?? await findRoomIdByTitle(roomTitle);

        await expectAppShell(guestPage);
        await waitForBlockingOverlayToDisappear(guestPage);
        await expect(guestPage.getByRole('button', { name: /서버 상태: 온라인/ })).toBeVisible({ timeout: 30_000 });
        const roomCard = guestPage.locator('.lobby-room-card').filter({ hasText: roomTitle }).first();
        await expect(roomCard).toBeVisible({ timeout: 25_000 });
        await roomCard.locator('.lobby-room-action').click();
        await expect(guestPage.getByTestId('waiting-room')).toBeVisible({ timeout: 20_000 });
        const readyButton = guestPage.getByRole('button', { name: '준비 완료' });
        if (await readyButton.isVisible().catch(() => false)) await readyButton.click();
        await expect(guestPage.getByRole('button', { name: '준비 취소' })).toBeVisible({ timeout: 10_000 });
        await expect(hostPage.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
        await hostPage.getByTestId('start-game-button').click();
        await expect(hostPage.getByTestId('game-screen'), `호스트 게임 진입 실패: ${JSON.stringify(await collectScreenState(hostPage), null, 2)}`).toBeVisible({ timeout: 35_000 });
        await expect(guestPage.getByTestId('game-screen'), `게스트 게임 진입 실패: ${JSON.stringify(await collectScreenState(guestPage), null, 2)}`).toBeVisible({ timeout: 35_000 });
      });

      const entries = [
        { page: hostPage, name: hostName },
        { page: guestPage, name: guestName },
      ];
      let roller = null;
      await runQaStep(testInfo, '실제 현재 턴 플레이어 확인', async () => {
        await expect.poll(async () => {
          roller = await findActiveRoller(entries);
          if (roller) return 'ready';
          return JSON.stringify(await Promise.all(entries.map(async (entry) => ({ name: entry.name, state: await collectScreenState(entry.page) }))));
        }, { timeout: 60_000, message: '순서 정하기가 끝난 뒤 실제 윷 던지기 가능한 플레이어가 나타나야 합니다.' }).toBe('ready');
      });

      const observer = entries.find((entry) => entry !== roller);
      expect(roller, '낙을 던질 플레이어를 찾을 수 있어야 합니다.').not.toBeNull();
      expect(observer, '다른 플레이어 화면을 관찰할 수 있어야 합니다.').toBeTruthy();
      if (!roller || !observer) return;

      await runQaStep(testInfo, '상대 화면 렌더러 프레임 지연 후 실제 낙 서버 액션 제출', async () => {
        await delayAnimationFrames(observer.page, REMOTE_RENDERER_FRAME_DELAY_MS);
        await startFallTimingObservation(observer.page);
        const forced = await clickForcedFall(roller.page);
        expect(forced.randomValuesUsed, '결과 4회, 낙 판정, 낙 개수, action id 순서의 난수를 사용해야 합니다.').toBeGreaterThanOrEqual(7);
      });

      await runQaStep(testInfo, '상대 화면 낙 전체 연출과 턴 표시 확인', async () => {
        const stage = observer.page.locator('.roll-stage');
        const fallMat = observer.page.locator('.roll-stage .roll-mat.fall-roll');
        const label = observer.page.locator('.roll-stage .roll-label');
        const scene = observer.page.locator('.roll-stage [data-testid="yut-roll-scene"]');
        const indicator = observer.page.getByTestId('turn-indicator');
        const currentBadge = indicator.locator('.turn-current-badge');
        const neighbors = indicator.locator('.turn-neighbor');

        await expect(stage, `상대 낙 연출이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(observer.page), null, 2)}`).toBeVisible({ timeout: 8_000 });
        await expect(stage).toHaveAttribute('data-settle-source', 'pending');
        await expect(fallMat, '상대 낙 결과에는 fall-roll 매트가 적용되어야 합니다.').toBeVisible({ timeout: 8_000 });
        await expect(scene, '상대 낙의 실제 윷 장면이 표시되어야 합니다.').toHaveAttribute('data-fall-count', '4', { timeout: 8_000 });
        await expect.poll(() => scene.getAttribute('data-renderer'), { timeout: 8_000, message: '상대 낙 장면이 Three.js 또는 CSS fallback 렌더러로 확정되어야 합니다.' }).toMatch(/^(three|fallback)$/);
        await expect(currentBadge, '낙 연출 중에는 던진 상대의 이름을 현재 턴으로 유지해야 합니다.').toHaveText(roller.name);
        await expect(neighbors, '낙 연출 중에도 이전·다음 턴 정보가 사라지면 안 됩니다.').toHaveCount(2);
        const neighborTexts = (await neighbors.allTextContents()).map((text) => text.trim());
        expect(neighborTexts, `낙 연출 중에는 던진 플레이어 기준 이전·다음 턴 이름이 유지되어야 합니다: ${JSON.stringify(neighborTexts)}`).toEqual([observer.name, observer.name]);

        await expect.poll(() => observer.page.evaluate(() => {
          const timing = window.__YUT_QA_REMOTE_FALL_TIMING__;
          return timing?.stageStartedAt ? performance.now() - timing.stageStartedAt : 0;
        }), {
          timeout: 7_000,
          message: '고정 2.2초 완료 타이머가 발동하던 시점 이후까지 렌더러 프레임을 지연해야 합니다.',
        }).toBeGreaterThanOrEqual(3_000);
        await expect(stage, '실제 렌더러 settle 전에는 낙 연출이 제거되면 안 됩니다.').toBeVisible();
        await expect(label, '실제 렌더러 settle 전에는 낙 결과가 공개되면 안 됩니다.').toBeHidden();
        await expect(stage).toHaveAttribute('data-settle-source', 'pending');

        await expect(stage, '실제 렌더러 콜백으로만 결과 유지 단계에 진입해야 합니다.').toHaveAttribute('data-settle-source', /^(three-renderer|css-animation-end)$/, { timeout: 6_000 });
        await expect(label, '윷이 매트 밖으로 빠지는 실제 settle 이후 낙 결과가 표시되어야 합니다.').toHaveText('낙!', { timeout: 2_000 });
        await expect(currentBadge, '결과 유지 중에도 던진 상대의 턴 표시가 유지되어야 합니다.').toHaveText(roller.name);
        await expect(neighbors, '결과 유지 중에도 전체 턴 정보가 유지되어야 합니다.').toHaveCount(2);
        await expect(stage, '낙 결과 유지가 끝난 뒤에만 연출이 종료되어야 합니다.').toBeHidden({ timeout: 6_000 });

        await expect.poll(() => observer.page.evaluate(() => window.__YUT_QA_REMOTE_FALL_TIMING__?.endedAt ?? 0), {
          timeout: 1_000,
          message: '상대 낙 연출의 시작·settle·종료 시각이 기록되어야 합니다.',
        }).toBeGreaterThan(0);
        const timing = await observer.page.evaluate(() => {
          window.__YUT_QA_REMOTE_FALL_OBSERVER__?.disconnect();
          return window.__YUT_QA_REMOTE_FALL_TIMING__ ?? { stageStartedAt: 0, labelStartedAt: 0, endedAt: 0 };
        });
        const landingDurationMs = timing.labelStartedAt - timing.stageStartedAt;
        const resultHoldDurationMs = timing.endedAt - timing.labelStartedAt;
        expect(timing.stageStartedAt).toBeGreaterThan(0);
        expect(timing.labelStartedAt).toBeGreaterThan(timing.stageStartedAt);
        expect(landingDurationMs, `지연된 렌더러가 실제 완료되기 전에 낙 결과를 공개하면 안 됩니다. 실제: ${landingDurationMs}ms`).toBeGreaterThanOrEqual(3_200);
        expect(resultHoldDurationMs, `settle 후 낙 결과를 최소 1.2초 유지해야 합니다. 실제: ${resultHoldDurationMs}ms`).toBeGreaterThanOrEqual(1_200);
        expect(resultHoldDurationMs, `낙 결과 유지가 비정상적으로 길어지면 안 됩니다. 실제: ${resultHoldDurationMs}ms`).toBeLessThanOrEqual(3_000);

        await expect.poll(async () => {
          const badgeText = await currentBadge.textContent();
          return badgeText?.replace(/\s*턴\s*$/, '').trim() ?? '';
        }, {
          timeout: 8_000,
          message: '낙 연출 종료 후 authoritative 다음 턴이 표시되어야 합니다.',
        }).toBe(observer.name);
      });
    } finally {
      await Promise.all([
        restoreAnimationFrames(hostPage),
        restoreAnimationFrames(guestPage),
      ]);
      await guestContext.close();
    }
  });
});
