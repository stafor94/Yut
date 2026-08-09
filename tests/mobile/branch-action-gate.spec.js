import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { waitForRoomQaAccess } from '../helpers/room-access.js';
import { deleteRoomForQa } from '../helpers/rooms.js';
import { seedRoomPieceAtNodeForQa } from '../helpers/room-state-fixture.js';

test.describe('Galaxy branch action eligibility', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('갈림길 말은 roll presentation과 authoritative ready 경계 전까지 어떤 게임 액션도 활성화하지 않는다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 회귀에서만 실행합니다.');
    testInfo.setTimeout(120_000);
    await page.setViewportSize({ width: 412, height: 915 });

    const hostName = normalizeQaNickname(makeQaName(testInfo, 'branch-gate-host'));
    const roomTitle = makeQaName(testInfo, 'branch-gate-room');
    await primeLobbyStorage(context, {
      nickname: hostName,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      stackedRollMode: 'false',
      pieceCount: '1',
    });
    await context.addInitScript(() => {
      window.__YUT_QA_TURN_ORDER_RESULT_QUEUE__ = ['모'];
      window.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__ = ['도'];
      window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3_000;

      const nativeRandom = Math.random;
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
        Math.random = () => 0.3;
        queueMicrotask(() => {
          Math.random = nativeRandom;
        });
      }, true);
    });

    await createRoomFromLobby(page, roomTitle);
    roomId = await waitForRoomQaAccess(page, { roomTitle });
    await page.getByTestId('add-ai-P2').click();
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('start-game-button').click();
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const state = await collectScreenState(page);
      const debug = state.yutDebug ?? {};
      return Array.isArray(debug.turnOrderIds)
        && debug.turnOrderIds.length === 2
        && !debug.turnOrderPhase?.active
        && !debug.turnOrderIntro
        && state.rollButton.visible
        && !state.rollButton.disabled;
    }, { timeout: 45_000, message: '갈림길 fixture 적용 전 첫 roll action이 가능해야 합니다.' }).toBe(true);

    const identity = await page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const ownerSeatId = typeof debug.localSeatId === 'string' ? debug.localSeatId : '';
      const piece = Array.isArray(debug.pieces)
        ? debug.pieces.find((candidate) => candidate?.ownerId === ownerSeatId)
        : null;
      return { ownerSeatId, pieceId: typeof piece?.id === 'string' ? piece.id : '' };
    });
    expect(identity.ownerSeatId).not.toBe('');
    expect(identity.pieceId).not.toBe('');

    await seedRoomPieceAtNodeForQa({
      roomId,
      authPage: page,
      ownerSeatId: identity.ownerSeatId,
      pieceId: identity.pieceId,
      nodeId: 'n06',
      turnDeadlineAt: Date.now() + 10_000,
    });
    await page.reload();
    await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const state = await collectScreenState(page);
      const debug = state.yutDebug ?? {};
      const trackedPiece = Array.isArray(debug.pieces)
        ? debug.pieces.find((piece) => piece?.id === identity.pieceId)
        : null;
      return Array.isArray(debug.turnOrderIds)
        && debug.turnOrderIds.length === 2
        && !debug.turnOrderPhase?.active
        && !debug.turnOrderIntro
        && trackedPiece?.nodeId === 'n06'
        && state.rollButton.visible
        && !state.rollButton.disabled;
    }, { timeout: 30_000, message: 'reload 뒤 n06 fixture와 동일 host roll turn이 action-ready여야 합니다.' }).toBe(true);

    const presentationObservation = page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let sawStage = false;
      let sawResultCard = false;
      const enabledActionsDuringStage = new Set();
      const sample = () => {
        const stage = document.querySelector('.roll-stage');
        if (stage) {
          sawStage = true;
          if (document.querySelector('[data-testid="roll-result-card"]')) sawResultCard = true;
          document.querySelectorAll('[data-testid="play-controls"] button').forEach((button) => {
            if (button instanceof HTMLButtonElement && !button.disabled) {
              enabledActionsDuringStage.add(button.getAttribute('data-testid') || button.textContent?.trim() || 'unnamed-button');
            }
          });
        }
        if (sawStage && !stage) {
          resolve({
            sawStage,
            sawResultCard,
            stageEndedAt: Date.now(),
            enabledActionsDuringStage: [...enabledActionsDuringStage],
          });
          return;
        }
        if (performance.now() - startedAt > 20_000) {
          reject(new Error('갈림길 roll presentation 종료를 관찰하지 못했습니다.'));
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));

    const submittedPositionPercent = await page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const submitInPerfectZone = () => {
        const meter = document.querySelector('.roll-timing-live-meter');
        const button = document.querySelector('[data-testid="roll-yut-button"]');
        const positionPercent = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
        if (button instanceof HTMLButtonElement && positionPercent >= 45 && positionPercent <= 55) {
          button.click();
          resolve(positionPercent);
          return;
        }
        if (performance.now() - startedAt > 3_000) {
          reject(new Error('갈림길 fixture에서 Perfect 구간 roll을 제출하지 못했습니다.'));
          return;
        }
        requestAnimationFrame(submitInPerfectZone);
      };
      requestAnimationFrame(submitInPerfectZone);
    }));
    expect(submittedPositionPercent).toBeGreaterThanOrEqual(45);
    expect(submittedPositionPercent).toBeLessThanOrEqual(55);

    const observation = await presentationObservation;
    expect(observation.sawStage).toBe(true);
    expect(observation.sawResultCard).toBe(true);
    expect(observation.enabledActionsDuringStage, 'roll presentation 중에는 play-controls의 어떤 게임 액션도 활성화되면 안 됩니다.').toEqual([]);

    await expect.poll(() => page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const readyAt = Number(debug.effectiveRollResultReadyAt ?? debug.rollResultReadyAt ?? 0);
      return debug.roll?.name === '개'
        && Number(debug.roll?.steps ?? 0) === 2
        && debug.turnDeadlineKind === 'move'
        && readyAt > 0;
    }), { timeout: 15_000, intervals: [50, 100, 200], message: 'authoritative 개 결과와 move presentation-ready 경계를 관찰해야 합니다.' }).toBe(true);

    const readyAt = await page.evaluate(() => Number(
      window.__YUT_DEBUG_STATE__?.effectiveRollResultReadyAt
      ?? window.__YUT_DEBUG_STATE__?.rollResultReadyAt
      ?? 0,
    ));
    expect(readyAt).toBeGreaterThan(0);

    if (observation.stageEndedAt < readyAt) {
      const preReadyExposure = await page.evaluate(({ authoritativeReadyAt }) => new Promise((resolve) => {
        const sample = () => {
          if (Date.now() >= authoritativeReadyAt) {
            resolve([]);
            return;
          }
          const enabledActions = [...document.querySelectorAll('[data-testid="play-controls"] button')]
            .filter((button) => button instanceof HTMLButtonElement && !button.disabled)
            .map((button) => button.getAttribute('data-testid') || button.textContent?.trim() || 'unnamed-button');
          if (enabledActions.length) {
            resolve(enabledActions);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }), { authoritativeReadyAt: readyAt });
      expect(preReadyExposure, 'renderer 종료 뒤라도 authoritative ready 전에는 게임 액션이 활성화되면 안 됩니다.').toEqual([]);
    }

    await expect.poll(() => page.evaluate(({ authoritativeReadyAt }) => {
      const controls = document.querySelector('.bottom-branch-controls');
      const buttons = controls ? [...controls.querySelectorAll('button')] : [];
      const moveButton = document.querySelector('[data-testid="move-piece-button"]');
      return Date.now() >= authoritativeReadyAt
        && Boolean(controls)
        && buttons.length >= 2
        && buttons.every((button) => button instanceof HTMLButtonElement && !button.disabled)
        && moveButton instanceof HTMLButtonElement
        && !moveButton.disabled;
    }, { authoritativeReadyAt: readyAt }), {
      timeout: 10_000,
      intervals: [50, 100, 200],
      message: 'authoritative ready 이후에만 갈림길 방향과 이동 액션이 활성화되어야 합니다.',
    }).toBe(true);

    await expect.poll(() => page.evaluate(({ pieceId }) => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const piece = Array.isArray(debug.pieces)
        ? debug.pieces.find((candidate) => candidate?.id === pieceId)
        : null;
      return [piece?.nodeId ?? '', debug.movingPieceId ?? ''];
    }, { pieceId: identity.pieceId }), {
      timeout: 2_000,
      message: '사용자 이동 입력 전에는 갈림길 말이 n06에 정지해 있어야 합니다.',
    }).toEqual(['n06', '']);
  });
});
