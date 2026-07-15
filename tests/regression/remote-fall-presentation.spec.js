import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const MOBILE_VIEWPORT = { width: 412, height: 915 };

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
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    sample();
  });
}

test.describe('remote fall presentation QA', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('상대 플레이어 낙은 끝까지 재생되고 상단 현재 턴 배지는 중앙을 유지한다', async ({ page: hostPage, context: hostContext, browser }, testInfo) => {
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

      await runQaStep(testInfo, '현재 플레이어가 실제 낙 4개 서버 액션 제출', async () => {
        await startFallTimingObservation(observer.page);
        const forced = await clickForcedFall(roller.page);
        expect(forced.randomValuesUsed, '결과 4회, 낙 판정, 낙 개수, action id 순서의 난수를 사용해야 합니다.').toBeGreaterThanOrEqual(7);
      });

      await runQaStep(testInfo, '상대 화면 낙 전체 연출과 턴 표시 확인', async () => {
        const stage = observer.page.locator('.roll-stage');
        const fallMat = observer.page.locator('.roll-stage .roll-mat.fall-roll');
        const scene = observer.page.locator('.roll-stage [data-testid="yut-roll-scene"]');
        const indicator = observer.page.getByTestId('turn-indicator');
        const currentBadge = indicator.locator('.turn-current-badge');

        await expect(stage, `상대 낙 연출이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(observer.page), null, 2)}`).toBeVisible({ timeout: 8_000 });
        await expect(fallMat, '상대 낙 결과에는 fall-roll 매트가 적용되어야 합니다.').toBeVisible({ timeout: 8_000 });
        await expect(scene, '상대 낙의 실제 윷 장면이 표시되어야 합니다.').toHaveAttribute('data-fall-count', '4', { timeout: 8_000 });
        await expect.poll(() => scene.getAttribute('data-renderer'), { timeout: 8_000, message: '상대 낙 장면이 Three.js 또는 CSS fallback 렌더러로 확정되어야 합니다.' }).toMatch(/^(three|fallback)$/);
        await expect(currentBadge, '낙 연출 중에는 던진 상대의 이름을 현재 턴으로 유지해야 합니다.').toHaveText(roller.name);
        await expect(indicator.locator('.turn-neighbor'), '낙 연출 중 이웃 턴 표시는 숨겨야 합니다.').toHaveCount(0);

        const alignment = await indicator.evaluate((node) => {
          const badge = node.querySelector('.turn-current-badge');
          if (!(badge instanceof HTMLElement)) return null;
          const indicatorRect = node.getBoundingClientRect();
          const badgeRect = badge.getBoundingClientRect();
          return {
            centerDeltaPx: Math.abs((indicatorRect.left + indicatorRect.width / 2) - (badgeRect.left + badgeRect.width / 2)),
            indicatorWidth: indicatorRect.width,
            badgeWidth: badgeRect.width,
          };
        });
        expect(alignment, '상단 현재 턴 배지의 위치를 측정할 수 있어야 합니다.').not.toBeNull();
        expect(alignment?.indicatorWidth ?? 0).toBeGreaterThan(alignment?.badgeWidth ?? 0);
        expect(alignment?.centerDeltaPx ?? 999, `낙 중 현재 턴 배지는 상단 표시 중앙에 있어야 합니다: ${JSON.stringify(alignment)}`).toBeLessThanOrEqual(2);

        await expect(observer.page.locator('.roll-stage .roll-label'), '윷이 매트 밖으로 빠지는 실제 settle 이후 낙 결과가 표시되어야 합니다.').toHaveText('낙!', { timeout: 8_000 });
        await expect(currentBadge, '결과 유지 중에도 던진 상대의 턴 표시가 유지되어야 합니다.').toHaveText(roller.name);
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
        expect(landingDurationMs, `상대 낙은 실제 착지·이탈 연출을 최소 1.8초 재생해야 합니다. 실제: ${landingDurationMs}ms`).toBeGreaterThanOrEqual(1_800);
        expect(resultHoldDurationMs, `settle 후 낙 결과를 최소 1.2초 유지해야 합니다. 실제: ${resultHoldDurationMs}ms`).toBeGreaterThanOrEqual(1_200);
        expect(resultHoldDurationMs, `낙 결과 유지가 비정상적으로 길어지면 안 됩니다. 실제: ${resultHoldDurationMs}ms`).toBeLessThanOrEqual(3_000);

        await expect(currentBadge, '낙 연출 종료 후 authoritative 다음 턴이 표시되어야 합니다.').toHaveText(observer.name, { timeout: 8_000 });
      });
    } finally {
      await guestContext.close();
    }
  });
});
