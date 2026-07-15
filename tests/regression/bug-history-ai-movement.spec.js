import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('BUG_HISTORY AI movement regression', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
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

});
