import { test, expect } from '@playwright/test';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import {
  attachConsoleErrorCapture,
  collectScreenState,
  createRoomFromLobby,
  expectNoBlockingConsoleErrors,
  primeLobbyStorage,
  primeTurnOrderResultQueues,
} from '../helpers/ui.js';
import {
  deleteRoomForQa,
  getRoomSequencesForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

const AI_ACTION_BEFORE_TIMEOUT_MS = 10_000;
const LEGACY_AI_FALLBACK_DELAY_MS = 1_000;

async function waitForHumanTurnReady(page) {
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 35_000 });
  await expect.poll(async () => {
    const state = await collectScreenState(page);
    const debug = state.yutDebug ?? {};
    return Boolean(
      Array.isArray(debug.turnOrderIds)
      && debug.turnOrderIds.length === 2
      && !debug.turnOrderPhase?.active
      && !debug.turnOrderIntro
      && state.rollButton.visible
      && !state.rollButton.disabled,
    );
  }, {
    timeout: 50_000,
    intervals: [100, 250, 500],
    message: 'AI 1:1 순서 정하기가 끝나고 사람 플레이어가 첫 윷을 던질 수 있어야 합니다.',
  }).toBe(true);
}

async function clickPerfectDo(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const sample = () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const button = document.querySelector('[data-testid="roll-yut-button"]');
      const position = Number(meter instanceof HTMLElement ? meter.dataset.positionPercent : NaN);
      if (button instanceof HTMLButtonElement && !button.disabled && position >= 45 && position <= 55) {
        button.click();
        resolve(undefined);
        return;
      }
      if (performance.now() - startedAt > 15_000) {
        reject(new Error('Perfect 구간에서 사람의 첫 도를 제출하지 못했습니다.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function startAiReadyTimingProbe(page, aiSeatId) {
  await page.evaluate(({ aiSeatId: targetAiSeatId }) => {
    const runtime = window;
    runtime.__YUT_QA_AI_READY_TIMING__ = {
      aiActionStartedAt: 0,
      authoritativeReadyAt: 0,
      deadlineAt: 0,
      presentationCompletedAt: 0,
      presentationCompletedWallAt: 0,
      sawMovePresentation: false,
    };

    const sample = () => {
      const timing = runtime.__YUT_QA_AI_READY_TIMING__;
      if (!timing || timing.aiActionStartedAt > 0) return;
      const debug = runtime.__YUT_DEBUG_STATE__ ?? {};
      const movingPieceId = String(debug.movingPieceId ?? '');
      if (movingPieceId) timing.sawMovePresentation = true;

      const activeSeatId = String(debug.activeSeat?.id ?? '');
      const deadlineAt = Number(debug.turnDeadlineAt ?? 0);
      const durationMs = Number(debug.currentTurnActionTimeoutMs ?? 0);
      const authoritativeReadyAt = deadlineAt > 0 && durationMs > 0 ? deadlineAt - durationMs : 0;
      const wallNow = Date.now();
      const presentationCompleted = Boolean(
        timing.sawMovePresentation
        && activeSeatId === targetAiSeatId
        && !movingPieceId
        && debug.turnDeadlineKind === 'roll'
        && deadlineAt > wallNow
        && authoritativeReadyAt > 0,
      );
      if (!timing.presentationCompletedAt && presentationCompleted) {
        timing.presentationCompletedAt = performance.now();
        timing.presentationCompletedWallAt = wallNow;
        timing.authoritativeReadyAt = authoritativeReadyAt;
        timing.deadlineAt = deadlineAt;
      }

      const pendingActions = Array.isArray(debug.pendingLocalRemoteActions)
        ? debug.pendingLocalRemoteActions
        : [];
      if (timing.presentationCompletedAt > 0 && pendingActions.some((entry) => (
        entry?.type === 'roll_yut'
        && String(entry?.key ?? '').startsWith(`roll_yut_ai:${targetAiSeatId}:`)
      ))) {
        timing.aiActionStartedAt = performance.now();
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { aiSeatId });
}

test.describe('AI turn progress after human move', () => {
  test.setTimeout(150_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('사람 첫 자동 이동 presentation 뒤 AI는 기본 1초 추가 대기 없이 authoritative action을 시작한다', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-galaxy', 'Galaxy 412×915 AI 턴 진행 회귀에서만 실행합니다.');

    await page.setViewportSize({ width: 412, height: 915 });
    const consoleErrors = [];
    attachConsoleErrorCapture(page, consoleErrors);
    const nickname = normalizeQaNickname(makeQaName(testInfo, 'ai-progress-human'));
    const roomTitle = makeQaName(testInfo, 'ai-progress-room');

    await primeLobbyStorage(context, {
      nickname,
      maxPlayers: '2',
      playMode: 'individual',
      itemMode: 'false',
      pieceCount: '2',
    });
    await context.addInitScript(() => {
      window.localStorage.setItem('yut-online:stackedRollMode', 'false');
      window.__YUT_QA_ROLL_TIMING_INITIAL_POSITION_PERCENT__ = 30;
      const nativeRandom = Math.random;
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('[data-testid="roll-yut-button"]')) return;
        if (document.querySelector('.turn-order-overlay')) return;
        Math.random = () => 0.1;
        queueMicrotask(() => {
          Math.random = nativeRandom;
        });
      }, true);
    });
    await primeTurnOrderResultQueues(context, { human: ['모'], ai: ['도'] });

    await createRoomFromLobby(page, roomTitle);
    roomId = await rememberRoomIdFromPage(page);
    expect(roomId).not.toBe('');

    const addAiButton = page.getByTestId('add-ai-P2');
    await expect(addAiButton).toBeVisible({ timeout: 15_000 });
    await addAiButton.click();
    await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId('start-game-button').click();
    await waitForHumanTurnReady(page);

    const identity = await page.evaluate(() => {
      const debug = window.__YUT_DEBUG_STATE__ ?? {};
      const localSeatId = String(debug.localSeatId ?? '');
      const turnOrderIds = Array.isArray(debug.turnOrderIds)
        ? debug.turnOrderIds.map((seatId) => String(seatId ?? '')).filter(Boolean)
        : [];
      const aiSeatId = turnOrderIds.find((seatId) => seatId !== localSeatId) ?? '';
      return { localSeatId, aiSeatId, turnOrderIds };
    });
    expect(identity.localSeatId).not.toBe('');
    expect(identity.turnOrderIds).toHaveLength(2);
    expect(identity.aiSeatId).not.toBe('');

    await startAiReadyTimingProbe(page, identity.aiSeatId);
    await clickPerfectDo(page);

    await expect.poll(async () => {
      const sequences = await getRoomSequencesForQa(roomId);
      const move = sequences.find((sequence) => sequence?.type === 'move_piece_resolved' && sequence?.actorId === identity.localSeatId);
      return move ? { sequence: Number(move.sequence ?? 0), actorId: String(move.actorId ?? '') } : null;
    }, {
      timeout: 25_000,
      intervals: [100, 200, 400],
      message: '사람의 첫 도가 자동 이동으로 authoritative move_piece_resolved를 만들어야 합니다.',
    }).not.toBeNull();

    await expect.poll(async () => page.evaluate(() => {
      const timing = window.__YUT_QA_AI_READY_TIMING__;
      return {
        aiActionStarted: Number(timing?.aiActionStartedAt ?? 0) > 0,
        presentationCompleted: Number(timing?.presentationCompletedAt ?? 0) > 0,
        sawMovePresentation: timing?.sawMovePresentation === true,
      };
    }), {
      timeout: AI_ACTION_BEFORE_TIMEOUT_MS,
      intervals: [50, 100, 200],
      message: '사람 이동 presentation 종료 뒤 AI roll_yut 예약이 관찰되어야 합니다.',
    }).toEqual({
      aiActionStarted: true,
      presentationCompleted: true,
      sawMovePresentation: true,
    });

    const timing = await page.evaluate(() => window.__YUT_QA_AI_READY_TIMING__);
    const authoritativeReadyAt = Number(timing?.authoritativeReadyAt ?? 0);
    const presentationCompletedWallAt = Number(timing?.presentationCompletedWallAt ?? 0);
    expect(authoritativeReadyAt).toBeGreaterThan(0);
    expect(presentationCompletedWallAt).toBeGreaterThan(0);
    expect(authoritativeReadyAt).toBeLessThanOrEqual(presentationCompletedWallAt);
    expect(Number(timing?.deadlineAt ?? 0)).toBeGreaterThan(presentationCompletedWallAt);
    const actionStartDelayMs = Number(timing?.aiActionStartedAt ?? 0) - Number(timing?.presentationCompletedAt ?? 0);
    expect(actionStartDelayMs).toBeGreaterThanOrEqual(0);
    expect(actionStartDelayMs).toBeLessThan(LEGACY_AI_FALLBACK_DELAY_MS - 100);

    await expect.poll(async () => {
      const sequences = await getRoomSequencesForQa(roomId);
      const humanMove = sequences.find((sequence) => sequence?.type === 'move_piece_resolved' && sequence?.actorId === identity.localSeatId);
      const humanMoveSequence = Number(humanMove?.sequence ?? 0);
      const aiAction = sequences.find((sequence) => (
        humanMoveSequence > 0
        && Number(sequence?.sequence ?? 0) > humanMoveSequence
        && sequence?.actorId === identity.aiSeatId
        && sequence?.type === 'roll_yut'
      ));
      const debug = await page.evaluate(() => {
        const current = window.__YUT_DEBUG_STATE__ ?? {};
        return {
          activeSeatId: String(current.activeSeatId ?? current.activeSeat?.id ?? ''),
          localSeatId: String(current.localSeatId ?? ''),
          onlineGameCoordinatorSeatId: String(current.onlineGameCoordinatorSeatId ?? ''),
          canCoordinateOnlineGame: Boolean(current.canCoordinateOnlineGame),
          turnIndex: Number(current.turnIndex ?? -1),
          turnDeadlineKind: String(current.turnDeadlineKind ?? ''),
          turnDeadlineAt: Number(current.turnDeadlineAt ?? 0),
          canRollNow: Boolean(current.canRollNow),
          canRequestMove: Boolean(current.canRequestMove),
          pendingLocalRemoteActionCount: Number(current.pendingLocalRemoteActionCount ?? -1),
        };
      });
      return {
        progressed: Boolean(humanMoveSequence > 0 && aiAction),
        humanMoveSequence,
        aiActionSequence: Number(aiAction?.sequence ?? 0),
        aiActorId: String(aiAction?.actorId ?? ''),
        debug,
      };
    }, {
      timeout: AI_ACTION_BEFORE_TIMEOUT_MS,
      intervals: [100, 200, 400],
      message: '사람 첫 자동 이동 뒤 AI 턴은 행동 제한시간 만료를 기다리지 않고 정상 roll_yut action을 시작해야 합니다.',
    }).toMatchObject({
      progressed: true,
      aiActorId: identity.aiSeatId,
    });

    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
