import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('BUG_HISTORY online sequence regression', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('온라인 윷 던지기는 sequence replay 애니메이션을 표시하고 이동 직후 경로 preview를 숨긴다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'seq-host'));
    const roomTitle = makeQaName(testInfo, 'seq-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3500;
    });

    const clickSequenceRollAtPerfect = async () => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        try {
          const result = await page.evaluate(() => {
            const meter = document.querySelector('.roll-timing-meter');
            const orb = document.querySelector('.roll-timing-orb');
            const button = document.querySelector('[data-testid="roll-yut-button"]');
            if (!meter || !orb || !(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false, positionPercent: -1 };
            const meterRect = meter.getBoundingClientRect();
            const orbRect = orb.getBoundingClientRect();
            const positionPercent = meterRect.width > 0
              ? ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100
              : -1;
            if (positionPercent < 47 || positionPercent > 53) return { clicked: false, positionPercent };

            window.__YUT_QA_RESULT_HOLD_OBSERVER__?.disconnect();
            const timing = { startedAt: 0, endedAt: 0 };
            window.__YUT_QA_RESULT_HOLD_TIMING__ = timing;
            let observer;
            const sample = () => {
              const visible = Boolean(document.querySelector('.roll-stage.resolved-from-pending.result-hold-roll'));
              const now = performance.now();
              if (visible && timing.startedAt === 0) timing.startedAt = now;
              if (!visible && timing.startedAt > 0 && timing.endedAt === 0) {
                timing.endedAt = now;
                observer?.disconnect();
              }
            };
            observer = new MutationObserver(sample);
            window.__YUT_QA_RESULT_HOLD_OBSERVER__ = observer;
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
            sample();
            button.click();
            return { clicked: true, positionPercent };
          });
          if (result.clicked) return result.positionPercent;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/Execution context was destroyed|Cannot find context|Target page, context or browser has been closed/u.test(message)) throw error;
          await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        }
        await page.waitForTimeout(16);
      }
      throw new Error('8초 동안 Perfect 구간에서 윷 던지기 버튼을 클릭하지 못했습니다.');
    };

    await runQaStep(testInfo, 'AI 게임 시작', async () => {
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '내 차례 윷 던지기 animation 확인', async () => {
      await page.setViewportSize({ width: 412, height: 915 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '온라인 sequence replay를 확인할 수 있는 내 차례 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');

      await clickSequenceRollAtPerfect();
      await expect(page.locator('.roll-stage.pending-roll'), `클릭 직후 서버 확정 전 pending 윷 애니메이션이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 500 });
      await expect(page.locator('.roll-stage.pending-roll .roll-stage-timing'), '클릭 후 500ms 이내 pending 단계에서는 클라이언트에서 확정한 타이밍 등급만 즉시 표시되어야 합니다.').toHaveText(/^(Normal|Good!|Perfect!)$/, { timeout: 500 });
      await expect(page.locator('.roll-stage.pending-roll .roll-stage-timing'), 'pending 타이밍 등급은 중복 렌더링하지 않아야 합니다.').toHaveCount(1);
      const pendingTimingText = await page.locator('.roll-stage.pending-roll .roll-stage-timing').innerText();
      const preResultGameText = await page.getByTestId('game-screen').innerText();
      const preResultTurnStackText = await page.locator('[data-testid="turn-indicator"]').innerText();
      await expect(page.locator('.roll-stage.pending-roll .roll-label'), 'pending 단계에서는 결과명을 추측할 수 있는 label을 숨겨야 합니다.').toHaveCount(0);
      const pendingScene = page.locator('.roll-stage.pending-roll [data-testid="yut-roll-scene"]');
      await expect(pendingScene, 'pending 단계에서는 새 Three.js 윷 장면 컨테이너가 표시되어야 합니다.').toBeVisible({ timeout: 500 });
      await expect(pendingScene, '클라이언트 윷 던지기는 primary 상승·회전 단계에서 시작해야 합니다.').toHaveAttribute('data-phase', 'primary');
      await expect(pendingScene.locator('.yut-roll-three-canvas'), 'Three.js 렌더러용 canvas는 한 개만 유지되어야 합니다.').toHaveCount(1);
      await expect(pendingScene.locator('.yut-roll-css-fallback .yut-stick'), 'WebGL 초기화 전이나 실패 시 사용할 CSS fallback 윷 4개를 유지해야 합니다.').toHaveCount(4);
      await expect(pendingScene.locator('.yut-mark'), 'pending 단계에서는 결과 면 표시를 숨겨야 합니다.').toHaveCount(0);
      await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        window.__YUT_QA_EXTRA_SPIN_SEEN__ = Boolean(document.querySelector('.roll-stage.pending-roll.extra-spin-roll'));
        const observer = new MutationObserver(() => {
          if (document.querySelector('.roll-stage.pending-roll.extra-spin-roll')) window.__YUT_QA_EXTRA_SPIN_SEEN__ = true;
        });
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__ = observer;
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      const pendingRendererAtStart = await pendingScene.getAttribute('data-renderer');
      expect(['loading', 'three', 'fallback'], 'pending 장면은 Three.js 초기화 또는 CSS fallback 상태여야 합니다.').toContain(pendingRendererAtStart);
      const landingStage = page.locator('.roll-stage.resolved-from-pending.landing-roll');
      await expect(landingStage, `서버 결과 도착 시 pending overlay를 같은 팝업의 landing 단계로 이어서 전환해야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 5_000 });
      await expect(landingStage.locator('.roll-label'), 'landing 단계에서는 결과명 공개 전이어야 합니다.').toHaveCount(0);
      const extraSpinSeen = await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        return Boolean(window.__YUT_QA_EXTRA_SPIN_SEEN__);
      });
      expect(extraSpinSeen, '클라이언트 선확정 결과는 Firebase 응답을 기다리는 extra-spin 단계로 넘어가면 안 됩니다.').toBe(false);
      const landingScene = landingStage.getByTestId('yut-roll-scene');
      await expect(landingScene, '서버 결과 도착 후 같은 3D 장면이 landing 단계로 이어져야 합니다.').toHaveAttribute('data-phase', 'landing');
      await expect(landingScene.locator('.yut-roll-three-canvas'), 'landing 단계에서도 동일한 Three.js canvas를 유지해야 합니다.').toHaveCount(1);
      await expect(landingScene.locator('.yut-roll-css-fallback .yut-stick'), 'landing 단계에서도 WebGL 실패 대비 fallback 윷 4개를 유지해야 합니다.').toHaveCount(4);

      const resultHoldStage = page.locator('.roll-stage.resolved-from-pending.result-hold-roll');
      await expect(resultHoldStage, '착지 후 같은 팝업이 result-hold 단계로 전환되어야 합니다.').toBeVisible({ timeout: 2_500 });
      const resultHoldScene = resultHoldStage.getByTestId('yut-roll-scene');
      await expect(resultHoldScene, '착지 완료 후 동일한 3D 장면이 result-hold 단계로 전환되어야 합니다.').toHaveAttribute('data-phase', 'result-hold');
      await expect.poll(async () => resultHoldScene.getAttribute('data-renderer'), {
        timeout: 5_000,
        message: 'Three.js 또는 CSS fallback 렌더러가 최종 확정되어야 합니다.',
      }).toMatch(/^(three|fallback)$/);
      const rendererPresentation = await resultHoldScene.evaluate((node) => {
        const canvas = node.querySelector('.yut-roll-three-canvas');
        const fallback = node.querySelector('.yut-roll-css-fallback');
        return {
          status: node.getAttribute('data-renderer'),
          canvasOpacity: canvas ? Number.parseFloat(getComputedStyle(canvas).opacity) : -1,
          fallbackVisibility: fallback ? getComputedStyle(fallback).visibility : 'missing',
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        };
      });
      expect(rendererPresentation.width, '결과 유지 장면은 실제 표시 너비를 가져야 합니다.').toBeGreaterThan(0);
      expect(rendererPresentation.height, '결과 유지 장면은 실제 표시 높이를 가져야 합니다.').toBeGreaterThan(0);
      if (rendererPresentation.status === 'three') {
        expect(rendererPresentation.canvasOpacity, 'Three.js 렌더러가 선택되면 canvas가 불투명하게 표시되어야 합니다.').toBeGreaterThan(0.9);
        expect(rendererPresentation.fallbackVisibility, 'Three.js 렌더러가 선택되면 CSS fallback은 숨겨야 합니다.').toBe('hidden');
      } else {
        expect(rendererPresentation.status, 'WebGL 초기화 실패 시 fallback 상태로 확정되어야 합니다.').toBe('fallback');
        expect(rendererPresentation.fallbackVisibility, 'fallback 렌더러가 선택되면 CSS 윷 장면이 보여야 합니다.').toBe('visible');
      }
      await expect(page.locator('.roll-stage.resolved-from-pending .roll-stage-timing'), '서버 authoritative 타이밍 등급이 확정 결과와 함께 표시되어야 합니다.').toHaveText(/^(Normal|Good!|Perfect!)$/, { timeout: 5_000 });
      await expect(page.locator('.roll-stage.resolved-from-pending .roll-stage-timing'), 'pending부터 resolved 전환까지 같은 타이밍 등급이 유지되어야 합니다.').toHaveText(pendingTimingText);
      await expect(page.locator('.roll-stage.resolved-from-pending .roll-stage-timing'), 'resolved 타이밍 등급도 중복 렌더링하지 않아야 합니다.').toHaveCount(1);
      const timingBox = await page.locator('.roll-stage.resolved-from-pending .roll-stage-timing').boundingBox();
      const matBox = await page.locator('.roll-stage.resolved-from-pending .roll-mat').boundingBox();
      expect(timingBox, '타이밍 등급 boundingBox를 확인할 수 있어야 합니다.').not.toBeNull();
      expect(matBox, '윷 매트 boundingBox를 확인할 수 있어야 합니다.').not.toBeNull();
      if (!timingBox || !matBox) return;
      const centerDeltaPx = Math.abs((timingBox.x + timingBox.width / 2) - (matBox.x + matBox.width / 2));
      expect(centerDeltaPx, `타이밍 등급과 윷 매트의 가로 중심 오차는 2px 이내여야 합니다. 실제: ${centerDeltaPx}px`).toBeLessThanOrEqual(2);
      const resolvedLabel = page.locator('.roll-stage.resolved-from-pending .roll-label');
      await expect(resolvedLabel, `서버 authoritative 윷 결과 label이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 5_000 });
      await expect(resolvedLabel, 'authoritative 결과 label은 한 번만 표시되어야 합니다.').toHaveCount(1);
      const timingTextAfterReveal = await page.locator('.roll-stage.resolved-from-pending .roll-stage-timing').innerText();
      const labelTextAfterReveal = await resolvedLabel.innerText();
      const postResultGameText = await page.getByTestId('game-screen').innerText();
      const postResultTurnStackText = await page.locator('[data-testid="turn-indicator"]').innerText();
      expect(postResultGameText.length, '결과명 표시 순간부터 최신 진행 기록이 공개되어 게임 화면 텍스트가 갱신되어야 합니다.').toBeGreaterThanOrEqual(preResultGameText.length);
      expect(postResultTurnStackText.length, '결과명 표시 순간부터 상단 이동 스택이 최신 상태로 공개되어야 합니다.').toBeGreaterThanOrEqual(preResultTurnStackText.length);
      const resolvedMatClassName = await page.locator('.roll-stage.resolved-from-pending .roll-mat').getAttribute('class');
      const resolvedMatClasses = (resolvedMatClassName ?? '').split(/\s+/);
      if (resolvedMatClasses.includes('bonus-roll') || resolvedMatClasses.includes('fall-roll')) {
        await expect.poll(async () => page.locator('.roll-stage.resolved-from-pending .roll-mat').evaluate((node) => {
          const style = getComputedStyle(node);
          return `${style.animationName}/${style.opacity}/${style.transform}`;
        }), {
          timeout: 1_000,
          message: 'pending에서 확정된 bonus/fall 매트는 class 추가 후에도 팝업 재시작 animation 없이 고정되어야 합니다.',
        }).toBe('none/1/matrix(1, 0, 0, 1, 0, 0)');
      }
      if (labelTextAfterReveal === '낙!') {
        expect(resolvedMatClasses, '낙 결과는 fall-roll만 적용하고 내부 display result가 윷/모여도 bonus-roll을 적용하지 않아야 합니다.').toContain('fall-roll');
        expect(resolvedMatClasses, '낙 결과는 bonus-roll을 절대 적용하지 않아야 합니다.').not.toContain('bonus-roll');
      } else if (labelTextAfterReveal === '윷' || labelTextAfterReveal === '모') {
        expect(resolvedMatClasses, '정상 윷/모 결과만 bonus-roll을 적용해야 합니다.').toContain('bonus-roll');
        expect(resolvedMatClasses, '정상 윷/모 결과는 fall-roll을 적용하지 않아야 합니다.').not.toContain('fall-roll');
      } else {
        expect(resolvedMatClasses, '도/개/걸 결과는 bonus-roll을 적용하지 않아야 합니다.').not.toContain('bonus-roll');
      }
      await expect(page.locator('.roll-stage'), 'result-hold 팝업은 정상적으로 종료되어야 합니다.').toBeHidden({ timeout: 4_000 });
      await expect.poll(() => page.evaluate(() => window.__YUT_QA_RESULT_HOLD_TIMING__?.endedAt ?? 0), {
        timeout: 500,
        message: 'result-hold의 실제 시작·종료 시각이 브라우저에서 기록되어야 합니다.',
      }).toBeGreaterThan(0);
      const resultHoldTiming = await page.evaluate(() => {
        window.__YUT_QA_RESULT_HOLD_OBSERVER__?.disconnect();
        return window.__YUT_QA_RESULT_HOLD_TIMING__ ?? { startedAt: 0, endedAt: 0 };
      });
      const resultHoldDurationMs = resultHoldTiming.endedAt - resultHoldTiming.startedAt;
      expect(resultHoldTiming.startedAt, 'result-hold 시작 시각이 기록되어야 합니다.').toBeGreaterThan(0);
      expect(resultHoldDurationMs, `result-hold는 실제 브라우저 시각 기준 최소 1.8초 유지되어야 합니다. 실제: ${resultHoldDurationMs}ms`).toBeGreaterThanOrEqual(1_800);
      expect(resultHoldDurationMs, `result-hold는 실제 브라우저 시각 기준 3.2초 이내 종료되어야 합니다. 실제: ${resultHoldDurationMs}ms`).toBeLessThanOrEqual(3_200);
    });

    await runQaStep(testInfo, '말 이동 직후 preview 제거 확인', async () => {
      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      let moveStarted = false;
      for (let attempt = 0; attempt < 5 && !moveStarted; attempt += 1) {
        let nextAction = '';
        await expect.poll(async () => {
          const state = await collectScreenState(page);
          if (state.moveButton.visible && !state.moveButton.disabled) {
            const moveButton = page.getByTestId('move-piece-button');
            const clicked = await moveButton.click({ timeout: 750 }).then(() => true).catch(() => false);
            if (!clicked) {
              const afterClickState = await collectScreenState(page);
              if (afterClickState.moveButton.visible && !afterClickState.moveButton.disabled) {
                return JSON.stringify(afterClickState, null, 2);
              }
            }
            nextAction = 'move';
            return 'ready';
          }
          if (state.rollButton.visible && !state.rollButton.disabled) {
            nextAction = 'roll';
            return 'ready';
          }
          return JSON.stringify(state, null, 2);
        }, { timeout: 45_000, message: '윷 결과가 이동 가능 상태가 되거나 이동 불가 빽도 후 다음 던지기 차례로 복귀해야 합니다.' }).toBe('ready');
        if (nextAction === 'move') {
          moveStarted = true;
          break;
        }
        await clickSequenceRollAtPerfect();
        await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      }
      expect(moveStarted, 'Perfect 구간에서 반복 던진 뒤 말 이동이 시작되어야 합니다.').toBe(true);
      await expect.poll(async () => page.locator('.board-node.route-preview').count(), {
        timeout: 2_000,
        message: '로컬 이동 애니메이션 종료 후 서버 확정 대기 중에는 예상 이동 경로가 없어야 합니다.',
      }).toBe(0);
    });
  });

});
