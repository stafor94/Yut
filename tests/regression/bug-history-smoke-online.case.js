import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';
import { createSequenceRollAtPerfect } from './bug-history-smoke-roll-helper.js';
import { verifyMovePreviewRemoval } from './bug-history-smoke-move-helper.js';

async function addAiAndWaitUntilGameCanStart(page, seatLabel = 'P2') {
  const addAiButton = page.getByTestId(`add-ai-${seatLabel}`);
  await expect(addAiButton, `${seatLabel} AI 추가 버튼이 대기실 동기화 후 표시되어야 합니다.`).toBeVisible({ timeout: 15_000 });
  await addAiButton.click();
  await expect(addAiButton, `${seatLabel} AI 추가가 완료되면 빈 자리 버튼이 사라져야 합니다.`).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('start-game-button'), 'AI 참가 상태가 반영된 뒤 게임 시작 버튼이 활성화되어야 합니다.').toBeEnabled({ timeout: 15_000 });
}

test.describe('BUG_HISTORY regression smoke', () => {
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


    const clickSequenceRollAtPerfect = createSequenceRollAtPerfect(page);

    await runQaStep(testInfo, 'AI 게임 시작', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await addAiAndWaitUntilGameCanStart(page);
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
      const pendingStage = page.locator('.roll-stage.pending-roll');
      await expect(pendingStage, `클릭 직후 서버 확정 전 pending 윷 애니메이션이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 500 });
      const pendingScene = pendingStage.getByTestId('yut-roll-scene');
      let pendingPresentation = null;
      await expect.poll(async () => {
        pendingPresentation = await pendingScene.evaluate((scene) => {
          const stage = scene.closest('.roll-stage.pending-roll');
          const timingNodes = stage ? Array.from(stage.querySelectorAll('.roll-stage-timing')) : [];
          return {
            phase: scene.getAttribute('data-phase'),
            renderer: scene.getAttribute('data-renderer'),
            canvasCount: scene.querySelectorAll('.yut-roll-three-canvas').length,
            fallbackStickCount: scene.querySelectorAll('.yut-roll-css-fallback .yut-stick').length,
            markCount: scene.querySelectorAll('.yut-mark').length,
            timingCount: timingNodes.length,
            timingText: timingNodes[0]?.textContent?.trim() ?? '',
            labelCount: stage?.querySelectorAll('.roll-label').length ?? -1,
            gameText: document.querySelector('[data-testid="game-screen"]')?.textContent ?? '',
            turnStackText: document.querySelector('[data-testid="turn-indicator"]')?.textContent ?? '',
          };
        }).catch(() => null);
        return pendingPresentation;
      }, {
        timeout: 1_500,
        intervals: [16, 32, 64],
        message: 'pending 장면이 primary 단계에서 Three.js canvas 1개와 CSS fallback 윷 4개를 함께 유지해야 합니다.',
      }).toMatchObject({
        phase: 'primary',
        canvasCount: 1,
        fallbackStickCount: 4,
        markCount: 0,
        timingCount: 0,
        labelCount: 0,
      });
      expect(pendingPresentation?.timingText ?? '', 'pending 단계에서는 서버 authoritative 결과가 확정되기 전 타이밍 등급을 공개하지 않아야 합니다.').toBe('');
      const preResultGameText = pendingPresentation?.gameText ?? '';
      const preResultTurnStackText = pendingPresentation?.turnStackText ?? '';
      await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        window.__YUT_QA_EXTRA_SPIN_SEEN__ = Boolean(document.querySelector('.roll-stage.pending-roll.extra-spin-roll'));
        const observer = new MutationObserver(() => {
          if (document.querySelector('.roll-stage.pending-roll.extra-spin-roll')) window.__YUT_QA_EXTRA_SPIN_SEEN__ = true;
        });
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__ = observer;
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      const pendingRendererAtStart = pendingPresentation?.renderer;
      expect(['loading', 'three', 'fallback'], 'pending 장면은 Three.js 초기화 또는 CSS fallback 상태여야 합니다.').toContain(pendingRendererAtStart);
      const landingStage = page.locator('.roll-stage.resolved-from-pending.landing-roll');
      await expect(landingStage, `서버 결과 도착 시 pending overlay를 같은 팝업의 landing 단계로 이어서 전환해야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 5_000 });
      const landingPresentation = await landingStage.evaluate((stage) => {
        const scene = stage.querySelector('[data-testid="yut-roll-scene"]');
        const resultPresentation = stage.querySelector('[data-testid="roll-result-presentation"]');
        return {
          labelCount: stage.querySelectorAll('.roll-label').length,
          presentationHidden: resultPresentation?.hidden ?? false,
          phase: scene?.getAttribute('data-phase') ?? '',
          canvasCount: scene?.querySelectorAll('.yut-roll-three-canvas').length ?? 0,
          fallbackStickCount: scene?.querySelectorAll('.yut-roll-css-fallback .yut-stick').length ?? 0,
        };
      });
      expect(landingPresentation, 'landing 단계는 결과 카드를 DOM에 유지하되 공개 전 숨기고 동일한 canvas와 fallback 윷을 유지해야 합니다.').toEqual({
        labelCount: 1,
        presentationHidden: true,
        phase: 'landing',
        canvasCount: 1,
        fallbackStickCount: 4,
      });
      const extraSpinSeen = await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        return Boolean(window.__YUT_QA_EXTRA_SPIN_SEEN__);
      });
      expect(extraSpinSeen, '클라이언트 선확정 결과는 Firebase 응답을 기다리는 extra-spin 단계로 넘어가면 안 됩니다.').toBe(false);

      let resultHoldPresentation = null;
      await expect.poll(async () => {
        resultHoldPresentation = await page.evaluate(() => window.__YUT_QA_RESULT_HOLD_PRESENTATION__ ?? null);
        return resultHoldPresentation;
      }, {
        timeout: 2_500,
        intervals: [16, 32, 64],
        message: '1초 result-hold가 종료되기 전에 렌더러·배치·결과·매트 상태를 한 snapshot으로 캡처해야 합니다.',
      }).not.toBeNull();
      if (!resultHoldPresentation) throw new Error('result-hold snapshot을 수집하지 못했습니다.');

      expect(resultHoldPresentation.sceneBox, '결과 유지 장면은 실제 표시 영역을 가져야 합니다.').not.toBeNull();
      if (!resultHoldPresentation.sceneBox) throw new Error('결과 유지 장면 boundingBox가 없습니다.');
      expect(resultHoldPresentation.sceneBox.width, '결과 유지 장면은 실제 표시 너비를 가져야 합니다.').toBeGreaterThan(0);
      expect(resultHoldPresentation.sceneBox.height, '결과 유지 장면은 실제 표시 높이를 가져야 합니다.').toBeGreaterThan(0);
      if (resultHoldPresentation.renderer === 'three') {
        expect(resultHoldPresentation.canvasOpacity, 'Three.js 렌더러가 선택되면 canvas가 불투명하게 표시되어야 합니다.').toBeGreaterThan(0.9);
        expect(resultHoldPresentation.fallbackVisibility, 'Three.js 렌더러가 선택되면 CSS fallback은 숨겨야 합니다.').toBe('hidden');
      } else {
        expect(resultHoldPresentation.renderer, 'WebGL 초기화 실패 시 fallback 상태로 확정되어야 합니다.').toBe('fallback');
        expect(resultHoldPresentation.fallbackVisibility, 'fallback 렌더러가 선택되면 CSS 윷 장면이 보여야 합니다.').toBe('visible');
      }
      expect(resultHoldPresentation.timingCount, 'resolved 타이밍 등급도 중복 렌더링하지 않아야 합니다.').toBe(1);
      expect(resultHoldPresentation.timingBox, '타이밍 등급 boundingBox를 확인할 수 있어야 합니다.').not.toBeNull();
      expect(resultHoldPresentation.matBox, '윷 매트 boundingBox를 확인할 수 있어야 합니다.').not.toBeNull();
      if (!resultHoldPresentation.timingBox || !resultHoldPresentation.matBox) throw new Error('result-hold 정렬 boundingBox가 없습니다.');
      const centerDeltaPx = Math.abs(
        (resultHoldPresentation.timingBox.x + resultHoldPresentation.timingBox.width / 2)
        - (resultHoldPresentation.matBox.x + resultHoldPresentation.matBox.width / 2),
      );
      expect(centerDeltaPx, `타이밍 등급과 윷 매트의 가로 중심 오차는 2px 이내여야 합니다. 실제: ${centerDeltaPx}px`).toBeLessThanOrEqual(2);
      expect(resultHoldPresentation.resultCardCount, 'authoritative 결과 카드는 한 번만 표시되어야 합니다.').toBe(1);
      expect(resultHoldPresentation.resultCardBox, '서버 authoritative 윷 결과 카드가 표시되어야 합니다.').not.toBeNull();
      expect(resultHoldPresentation.resultName, '결과 카드에는 윷 결과명이 표시되어야 합니다.').not.toBe('');
      expect(resultHoldPresentation.resultDescription, '결과 카드에는 이동 또는 실패 설명이 표시되어야 합니다.').not.toBe('');
      expect(resultHoldPresentation.gameText.length, '결과명 표시 순간부터 최신 진행 기록이 공개되어 게임 화면 텍스트가 갱신되어야 합니다.').toBeGreaterThanOrEqual(preResultGameText.length);
      expect(resultHoldPresentation.turnStackText.length, '결과명 표시 순간부터 상단 이동 스택이 최신 상태로 공개되어야 합니다.').toBeGreaterThanOrEqual(preResultTurnStackText.length);

      const resultNameAfterReveal = resultHoldPresentation.resultName;
      const resolvedMatClasses = resultHoldPresentation.matClassName.split(/\s+/u);
      if (resultNameAfterReveal === '낙') {
        expect(resolvedMatClasses, '낙 결과는 fall-roll만 적용하고 내부 display result가 윷/모여도 bonus-roll을 적용하지 않아야 합니다.').toContain('fall-roll');
        expect(resolvedMatClasses, '낙 결과는 bonus-roll을 절대 적용하지 않아야 합니다.').not.toContain('bonus-roll');
      } else if (resultNameAfterReveal === '윷' || resultNameAfterReveal === '모') {
        expect(resolvedMatClasses, '정상 윷/모 결과만 bonus-roll을 적용해야 합니다.').toContain('bonus-roll');
        expect(resolvedMatClasses, '정상 윷/모 결과는 fall-roll을 적용하지 않아야 합니다.').not.toContain('fall-roll');
      } else {
        expect(resolvedMatClasses, '도/개/걸 결과는 bonus-roll을 적용하지 않아야 합니다.').not.toContain('bonus-roll');
      }
      await expect(page.locator('.roll-stage'), 'result-hold 팝업은 정상적으로 종료되어야 합니다.').toBeHidden({ timeout: 4_000 });
      await expect.poll(() => page.evaluate(() => window.__YUT_QA_RESULT_HOLD_TIMING__?.endedAt ?? 0), {
        timeout: 1_000,
        message: 'result-hold의 실제 시작·종료 시각이 브라우저에서 기록되어야 합니다.',
      }).toBeGreaterThan(0);
      const resultHoldTiming = await page.evaluate(() => {
        window.__YUT_QA_RESULT_HOLD_OBSERVER__?.disconnect();
        return window.__YUT_QA_RESULT_HOLD_TIMING__ ?? { startedAt: 0, endedAt: 0 };
      });
      const resultHoldDurationMs = resultHoldTiming.endedAt - resultHoldTiming.startedAt;
      expect(resultHoldTiming.startedAt, 'result-hold 시작 시각이 기록되어야 합니다.').toBeGreaterThan(0);
      expect(resultHoldDurationMs, `result-hold는 실제 브라우저에서 관찰 가능한 양의 구간이어야 합니다. 실제: ${resultHoldDurationMs}ms`).toBeGreaterThan(0);
      expect(resultHoldDurationMs, `단축된 result-hold는 실제 브라우저 시각 기준 2초 이내 종료되어야 합니다. 실제: ${resultHoldDurationMs}ms`).toBeLessThanOrEqual(2_000);
    });

    await verifyMovePreviewRemoval({
      page,
      testInfo,
      expect,
      collectScreenState,
      runQaStep,
      clickSequenceRollAtPerfect,
    });
  });

});
