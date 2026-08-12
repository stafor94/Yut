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
  getRoomStateForQa,
  rememberRoomIdFromPage,
} from '../helpers/rooms.js';

const AI_ACTION_BEFORE_TIMEOUT_MS = 10_000;

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

test.describe('AI turn progress after human move', () => {
  test.setTimeout(150_000);

  let roomId;

  test.afterEach(async () => {
    if (roomId) await deleteRoomForQa(roomId).catch(() => undefined);
    roomId = undefined;
  });

  test('사람 첫 자동 이동 뒤 AI 턴은 timeout 대기 없이 authoritative action을 시작한다', async ({ page, context }, testInfo) => {
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
      const gameSeats = Array.isArray(debug.gameSeats) ? debug.gameSeats : [];
      const aiSeat = gameSeats.find((seat) => seat?.id && seat.id !== localSeatId && seat?.isAI === true);
      return { localSeatId, aiSeatId: String(aiSeat?.id ?? '') };
    });
    expect(identity.localSeatId).not.toBe('');
    expect(identity.aiSeatId).not.toBe('');

    await clickPerfectDo(page);

    const humanMoveSequence = await expect.poll(async () => {
      const sequences = await getRoomSequencesForQa(roomId);
      const move = sequences.find((sequence) => sequence?.type === 'move_piece_resolved' && sequence?.actorId === identity.localSeatId);
      return move ? { sequence: Number(move.sequence ?? 0), actorId: String(move.actorId ?? '') } : null;
    }, {
      timeout: 25_000,
      intervals: [100, 200, 400],
      message: '사람의 첫 도가 자동 이동으로 authoritative move_piece_resolved를 만들어야 합니다.',
    }).not.toBeNull();

    const stateAfterHumanMove = await getRoomStateForQa(roomId);
    expect(String(stateAfterHumanMove?.gameSeats?.find((seat) => seat?.isAI)?.id ?? identity.aiSeatId)).toBe(identity.aiSeatId);

    await expect.poll(async () => {
      const sequences = await getRoomSequencesForQa(roomId);
      const humanMove = sequences.find((sequence) => sequence?.type === 'move_piece_resolved' && sequence?.actorId === identity.localSeatId);
      const humanMoveSequenceNumber = Number(humanMove?.sequence ?? 0);
      const aiAction = sequences.find((sequence) => (
        Number(sequence?.sequence ?? 0) > humanMoveSequenceNumber
        && sequence?.actorId === identity.aiSeatId
        && sequence?.type === 'roll_yut'
      ));
      return {
        humanMoveSequence: humanMoveSequenceNumber,
        aiActionSequence: Number(aiAction?.sequence ?? 0),
        aiActorId: String(aiAction?.actorId ?? ''),
      };
    }, {
      timeout: AI_ACTION_BEFORE_TIMEOUT_MS,
      intervals: [100, 200, 400],
      message: '사람 첫 자동 이동 뒤 AI 턴은 행동 제한시간 만료를 기다리지 않고 정상 roll_yut action을 시작해야 합니다.',
    }).toMatchObject({
      humanMoveSequence: expect.any(Number),
      aiActionSequence: expect.any(Number),
      aiActorId: identity.aiSeatId,
    });

    expectNoBlockingConsoleErrors(consoleErrors);
  });
});
