import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

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

  test('게임 시작 직후 윷 던지기/대기 버튼 상태가 고착되지 않는다', async ({ page, context }, testInfo) => {
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'reg-host'));
    const roomTitle = makeQaName(testInfo, 'reg-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });

    await runQaStep(testInfo, 'AI 게임 시작', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await addAiAndWaitUntilGameCanStart(page);
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('start-countdown-overlay')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '턴 컨트롤 상태 진단', async () => {
      const state = await collectScreenState(page);
      expect(
        state.rollButton.visible || state.moveButton.visible || state.turnWaitingButton.visible,
        `턴 컨트롤이 없는 상태입니다: ${JSON.stringify(state, null, 2)}`,
      ).toBe(true);
    });
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
        timingCount: 1,
        labelCount: 0,
      });
      const pendingTimingText = pendingPresentation?.timingText ?? '';
      expect(pendingTimingText, '클릭 후 pending 단계에서는 클라이언트에서 확정한 타이밍 등급 하나만 즉시 표시되어야 합니다.').toMatch(/^(Normal|Good!|Perfect!)$/);
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
        return {
          labelCount: stage.querySelectorAll('.roll-label').length,
          phase: scene?.getAttribute('data-phase') ?? '',
          canvasCount: scene?.querySelectorAll('.yut-roll-three-canvas').length ?? 0,
          fallbackStickCount: scene?.querySelectorAll('.yut-roll-css-fallback .yut-stick').length ?? 0,
        };
      });
      expect(landingPresentation, 'landing 단계는 결과명 공개 전 동일한 canvas와 fallback 윷을 유지해야 합니다.').toEqual({
        labelCount: 0,
        phase: 'landing',
        canvasCount: 1,
        fallbackStickCount: 4,
      });
      const extraSpinSeen = await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        return Boolean(window.__YUT_QA_EXTRA_SPIN_SEEN__);
      });
      expect(extraSpinSeen, '클라이언트 선확정 결과는 Firebase 응답을 기다리는 extra-spin 단계로 넘어가면 안 됩니다.').toBe(false);

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
      let moveReady = false;
      for (let attempt = 0; attempt < 5 && !moveReady; attempt += 1) {
        let nextAction = '';
        await expect.poll(async () => {
          const state = await collectScreenState(page);
          if (state.moveButton.visible && !state.moveButton.disabled) {
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
          moveReady = true;
          break;
        }
        await clickSequenceRollAtPerfect();
        await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      }
      expect(moveReady, 'Perfect 구간에서 반복 던진 뒤 말 이동 버튼이 활성화되어야 합니다.').toBe(true);

      await expect.poll(async () => page.evaluate(() => {
        const button = document.querySelector('[data-testid="move-piece-button"]');
        if (button instanceof HTMLButtonElement && !button.disabled) {
          button.click();
          return 'clicked';
        }
        return document.querySelector('.piece-token.moving') ? 'auto-moving' : 'waiting';
      }), {
        timeout: 2_000,
        message: '수동 이동 버튼 클릭 또는 단일 이동 후보의 자동 이동이 시작되어야 합니다.',
      }).toMatch(/^(clicked|auto-moving)$/);
      await expect.poll(async () => page.locator('.board-node.route-preview').count(), {
        timeout: 2_000,
        message: '로컬 이동 애니메이션 종료 후 서버 확정 대기 중에는 예상 이동 경로가 없어야 합니다.',
      }).toBe(0);
    });
  });

  test('host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다', async ({ page, context }, testInfo) => {
    testInfo.setTimeout(150_000);
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'ai-seq-host'));
    const roomTitle = makeQaName(testInfo, 'ai-seq-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    const knownAiMoveMutationIds = new Set();

    const getMovingPieces = () => page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const pieces = Array.isArray(debug.pieces) ? debug.pieces : [];
      const localSeatId = String(debug.localSeatId ?? '');
      return Array.from(document.querySelectorAll('[data-testid^="piece-"]'))
        .map((node) => {
          const testId = node.getAttribute('data-testid') ?? '';
          const pieceId = testId.replace(/^piece-/, '');
          const debugPiece = pieces.find((piece) => piece && typeof piece === 'object' && piece.id === pieceId) ?? {};
          const rect = node.getBoundingClientRect();
          return {
            testId,
            ownerId: String(debugPiece.ownerId ?? ''),
            isLocalOwner: Boolean(localSeatId && debugPiece.ownerId === localSeatId),
            className: node.getAttribute('class') ?? '',
            left: Math.round(rect.left),
            top: Math.round(rect.top),
          };
        })
        .filter((piece) => piece.className.includes('moving'));
    });

    const startAiMoveObservation = () => page.evaluate(() => {
      if (window.__YUT_QA_AI_MOVE_OBSERVER__) window.clearInterval(window.__YUT_QA_AI_MOVE_OBSERVER__);
      window.__YUT_QA_AI_MOVE_OBSERVATIONS__ = {};
      window.__YUT_QA_AI_MOVE_OBSERVER__ = window.setInterval(() => {
        const debug = window.__YUT_DEBUG_STATE__ ?? {};
        const pieces = Array.isArray(debug.pieces) ? debug.pieces : [];
        const localSeatId = String(debug.localSeatId ?? '');
        const mutationIds = debug.actionPipeline?.localClientMutationIds;
        const latestAiMoveMutationId = Array.isArray(mutationIds)
          ? [...mutationIds].reverse().find((mutationId) => typeof mutationId === 'string' && mutationId.startsWith('move_piece_ai:')) ?? ''
          : '';
        if (!latestAiMoveMutationId) return;

        const observations = window.__YUT_QA_AI_MOVE_OBSERVATIONS__;
        const observed = Array.isArray(observations[latestAiMoveMutationId]) ? observations[latestAiMoveMutationId] : [];
        for (const node of document.querySelectorAll('[data-testid^="piece-"]')) {
          const className = node.getAttribute('class') ?? '';
          if (!className.includes('moving')) continue;
          const testId = node.getAttribute('data-testid') ?? '';
          const pieceId = testId.replace(/^piece-/, '');
          const debugPiece = pieces.find((piece) => piece && typeof piece === 'object' && piece.id === pieceId) ?? {};
          if (localSeatId && debugPiece.ownerId === localSeatId) continue;
          const rect = node.getBoundingClientRect();
          const position = `${testId}:${Math.round(rect.left)},${Math.round(rect.top)}`;
          if (!observed.includes(position)) observed.push(position);
        }
        observations[latestAiMoveMutationId] = observed;
      }, 40);
    });

    const getObservedAiMovePositions = (mutationId) => page.evaluate((targetMutationId) => {
      const observations = window.__YUT_QA_AI_MOVE_OBSERVATIONS__ ?? {};
      const positions = observations[targetMutationId];
      return Array.isArray(positions) ? [...positions] : [];
    }, mutationId);

    const clickRollAtPerfect = () => page.evaluate(() => new Promise((resolve, reject) => {
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
          if (positionPercent >= 47 && positionPercent <= 53) {
            button.click();
            resolve(positionPercent);
            return;
          }
        }
        if (performance.now() - startedAt > 8_000) {
          reject(new Error('8초 동안 Perfect 구간에서 윷 던지기 버튼을 클릭하지 못했습니다.'));
          return;
        }
        requestAnimationFrame(sample);
      };
      sample();
    }));

    const clickMoveWhenReadyOrWaitForRetry = () => page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const sample = () => {
        const moveButton = document.querySelector('[data-testid="move-piece-button"]');
        if (moveButton instanceof HTMLButtonElement && !moveButton.disabled) {
          window.__YUT_QA_LOCAL_MOVE_OBSERVER__?.disconnect();
          if (window.__YUT_QA_LOCAL_MOVE_OBSERVER_TIMEOUT__) window.clearTimeout(window.__YUT_QA_LOCAL_MOVE_OBSERVER_TIMEOUT__);
          window.__YUT_QA_LOCAL_MOVE_SEEN__ = false;
          const selectedTestIds = new Set(Array.from(document.querySelectorAll('[data-testid^="piece-"].selected'))
            .map((node) => node.getAttribute('data-testid') ?? '')
            .filter(Boolean));
          const scan = () => {
            const movingSelectedPiece = Array.from(document.querySelectorAll('[data-testid^="piece-"].moving'))
              .some((node) => selectedTestIds.has(node.getAttribute('data-testid') ?? ''));
            if (!movingSelectedPiece) return;
            window.__YUT_QA_LOCAL_MOVE_SEEN__ = true;
            window.__YUT_QA_LOCAL_MOVE_OBSERVER__?.disconnect();
          };
          const observer = new MutationObserver(scan);
          window.__YUT_QA_LOCAL_MOVE_OBSERVER__ = observer;
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
          window.__YUT_QA_LOCAL_MOVE_OBSERVER_TIMEOUT__ = window.setTimeout(() => observer.disconnect(), 3_000);
          moveButton.click();
          scan();
          queueMicrotask(scan);
          requestAnimationFrame(scan);
          resolve('move-clicked');
          return;
        }
        const rollButton = document.querySelector('[data-testid="roll-yut-button"]');
        if (rollButton instanceof HTMLButtonElement && !rollButton.disabled) {
          resolve('retry');
          return;
        }
        if (performance.now() - startedAt > 45_000) {
          reject(new Error('이동 버튼 활성화 또는 이동 불가 결과 후 다음 윷 던지기 차례 복귀를 확인하지 못했습니다.'));
          return;
        }
        requestAnimationFrame(sample);
      };
      sample();
    }));

    await runQaStep(testInfo, 'host+AI 온라인 게임 시작', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      await addAiAndWaitUntilGameCanStart(page);
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '본인 이동은 optimistic 애니메이션 후 sequence에서 재재생되지 않음', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '본인 이동 검증을 위해 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');
      const stateBeforeLocalRoll = await collectScreenState(page);
      const mutationIdsBeforeLocalRoll = stateBeforeLocalRoll.yutDebug?.actionPipeline?.localClientMutationIds;
      if (Array.isArray(mutationIdsBeforeLocalRoll)) {
        for (const mutationId of mutationIdsBeforeLocalRoll) {
          if (typeof mutationId === 'string' && mutationId.startsWith('move_piece_ai:')) knownAiMoveMutationIds.add(mutationId);
        }
      }
      await startAiMoveObservation();
      let localMoveReady = false;
      for (let attempt = 0; attempt < 5 && !localMoveReady; attempt += 1) {
        await expect.poll(async () => {
          const state = await collectScreenState(page);
          if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
          return JSON.stringify(state, null, 2);
        }, { timeout: 45_000, message: `본인 이동 검증용 ${attempt + 1}번째 윷 던지기 차례가 활성화되어야 합니다.` }).toBe('ready');
        await clickRollAtPerfect();
        await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
        const rollOutcome = await clickMoveWhenReadyOrWaitForRetry();
        localMoveReady = rollOutcome === 'move-clicked';
      }
      expect(localMoveReady, 'Perfect 구간에서 반복 던진 뒤 활성화된 본인 말 이동 버튼을 실제로 클릭해야 합니다.').toBe(true);
      await expect.poll(() => page.evaluate(() => Boolean(window.__YUT_QA_LOCAL_MOVE_SEEN__)), {
        timeout: 8_000,
        message: '본인 optimistic 이동 애니메이션이 한 번 이상 관찰되어야 합니다.',
      }).toBe(true);
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 12_000, message: '본인 optimistic 이동 애니메이션이 종료되어야 합니다.' }).toBe(0);
      await page.waitForTimeout(1_200);
      expect(await getMovingPieces(), '서버 sequence 확정 후 본인 말 이동이 다시 재생되면 안 됩니다.').toEqual([]);
    });

    await runQaStep(testInfo, 'AI 대리 제출 이동은 authoritative 이동 칸 수에 맞게 재생됨', async () => {
      const deadline = Date.now() + 70_000;
      let lastDiagnostic = 'AI 이동 mutation 대기 중';
      while (Date.now() < deadline) {
        const state = await collectScreenState(page);
        const mutationIds = state.yutDebug?.actionPipeline?.localClientMutationIds;
        const latestAiMoveMutationId = Array.isArray(mutationIds)
          ? [...mutationIds].reverse().find((mutationId) => (
            typeof mutationId === 'string'
            && mutationId.startsWith('move_piece_ai:')
            && !knownAiMoveMutationIds.has(mutationId)
            && Boolean(mutationId.split(':')[4])
          )) ?? ''
          : '';
        const aiMoveSteps = Number(latestAiMoveMutationId.split(':')[6]);
        const requiredPositions = Number.isFinite(aiMoveSteps)
          ? Math.min(2, Math.max(1, Math.abs(aiMoveSteps)))
          : 2;
        const observedPositions = latestAiMoveMutationId ? await getObservedAiMovePositions(latestAiMoveMutationId) : [];
        if (latestAiMoveMutationId && observedPositions.length >= requiredPositions) return;

        lastDiagnostic = `requiredPositions=${requiredPositions} aiMoveSteps=${Number.isFinite(aiMoveSteps) ? aiMoveSteps : 'unknown'} mutation=${latestAiMoveMutationId || 'pending'} positions=${observedPositions.join('|')} state=${JSON.stringify(state.yutDebug ?? {}, null, 2)}`;
        const branchControls = page.locator('.bottom-branch-controls');
        if (await branchControls.isVisible().catch(() => false)) {
          await branchControls.getByRole('button', { name: '바깥길' }).click();
          const branchMoveButton = branchControls.locator('.branch-move-button');
          await expect(branchMoveButton, '분기 방향 선택 후 이동 버튼이 활성화되어야 합니다.').toBeEnabled({ timeout: 2_000 });
          await branchMoveButton.click();
          await expect.poll(async () => (await getMovingPieces()).filter((piece) => piece.isLocalOwner).length, {
            timeout: 8_000,
            message: '분기점 추가 턴의 로컬 말 이동 애니메이션이 시작되어야 합니다.',
          }).toBeGreaterThan(0);
          await expect.poll(async () => (await getMovingPieces()).filter((piece) => piece.isLocalOwner).length, {
            timeout: 12_000,
            message: '분기점 추가 턴의 로컬 말 이동 애니메이션이 종료되어야 합니다.',
          }).toBe(0);
          continue;
        }
        if (state.rollButton.visible && !state.rollButton.disabled) {
          await clickRollAtPerfect();
          await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
          continue;
        }
        if (state.moveButton.visible && !state.moveButton.disabled) {
          const outcome = await clickMoveWhenReadyOrWaitForRetry();
          if (outcome === 'move-clicked') {
            await expect.poll(async () => (await getMovingPieces()).filter((piece) => piece.isLocalOwner).length, {
              timeout: 8_000,
              message: '추가 턴의 로컬 말 이동 애니메이션이 시작되어야 합니다.',
            }).toBeGreaterThan(0);
            await expect.poll(async () => (await getMovingPieces()).filter((piece) => piece.isLocalOwner).length, {
              timeout: 12_000,
              message: '추가 턴의 로컬 말 이동 애니메이션이 종료되어야 합니다.',
            }).toBe(0);
          }
          continue;
        }
        await page.waitForTimeout(100);
      }
      expect(lastDiagnostic, '추가 던지기·잡기 보너스를 처리한 뒤 실제 AI 칸별 이동이 관찰되어야 합니다.').toBe('animated');
    });

  });

  test('timeout 벌칙은 오프라인 로컬 timeout에만 적용된다', async () => {
    const appSource = readFileSync('src/app/App.tsx', 'utf8');

    expect(appSource).toContain('const PENALTY_TURN_ACTION_TIMEOUT_MS = 10000;');
    expect(appSource).toContain('const getTurnActionTimeoutMs = (seatId = activeSeat?.id ?? \'\') => activeRoomId ? TURN_ACTION_TIMEOUT_MS');
    expect(appSource).toContain('const getItemPromptTimeoutMs = (seatId = localSeatId) => activeRoomId ? ITEM_PROMPT_TIMEOUT_MS');
    expect(appSource).toContain('if (!seatId || activeRoomId) return;');

    const onlineItemPromptEffect = appSource.slice(
      appSource.indexOf('if (activeRoomId) {', appSource.indexOf('if (!itemPromptTiming) return undefined;')),
      appSource.indexOf('const timeoutMs = getItemPromptTimeoutMs(localSeatId);'),
    );
    expect(onlineItemPromptEffect).not.toContain('markTurnActionTimedOut');

    const skipItemPromptHandler = appSource.slice(
      appSource.indexOf('onSkipItemPrompt={() => {'),
      appSource.indexOf('onUseItem={useItem}'),
    );
    expect(skipItemPromptHandler.indexOf('if (activeRoomId)')).toBeLessThan(skipItemPromptHandler.indexOf('clearTurnActionTimeoutPenalty(localSeatId);'));
  });

});
