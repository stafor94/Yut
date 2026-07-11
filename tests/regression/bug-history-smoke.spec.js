import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

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
      await expectAppShell(page);
      await page.getByTestId('room-title-input').fill(roomTitle);
      await page.getByTestId('create-room-button').click();
      await expect(page.getByTestId('waiting-room')).toBeVisible({ timeout: 25_000 });
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
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

      await page.getByTestId('roll-yut-button').click();
      await expect(page.locator('.roll-stage.pending-roll'), `클릭 직후 서버 확정 전 pending 윷 애니메이션이 표시되어야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 500 });
      await expect(page.locator('.roll-stage.pending-roll .roll-stage-timing'), '클릭 후 500ms 이내 pending 단계에서는 클라이언트에서 확정한 타이밍 등급만 즉시 표시되어야 합니다.').toHaveText(/^(Normal|Good!|Perfect!)$/, { timeout: 500 });
      await expect(page.locator('.roll-stage.pending-roll .roll-stage-timing'), 'pending 타이밍 등급은 중복 렌더링하지 않아야 합니다.').toHaveCount(1);
      const pendingTimingText = await page.locator('.roll-stage.pending-roll .roll-stage-timing').innerText();
      const preResultGameText = await page.getByTestId('game-screen').innerText();
      const preResultTurnStackText = await page.locator('[data-testid="turn-indicator"]').innerText();
      await expect(page.locator('.roll-stage.pending-roll .roll-label'), 'pending 단계에서는 결과명을 추측할 수 있는 label을 숨겨야 합니다.').toHaveCount(0);
      await expect(page.locator('.roll-stage.pending-roll .yut-mark'), 'pending 단계에서는 결과 면을 노출하지 않아야 합니다.').toHaveCount(0);
      await expect(page.locator('.roll-stage.pending-roll .yut-stick-flat-face'), 'pending 단계에서도 앞면 DOM은 4개 모두 렌더되어야 합니다.').toHaveCount(4);
      await expect(page.locator('.roll-stage.pending-roll .yut-stick-round-face'), 'pending 단계에서도 뒷면 DOM은 4개 모두 렌더되어야 합니다.').toHaveCount(4);
      const firstPendingStick = page.locator('.roll-stage.pending-roll .yut-stick').first();
      const firstPendingBody = page.locator('.roll-stage.pending-roll .yut-stick-body').first();
      await expect.poll(async () => firstPendingStick.evaluate((node) => getComputedStyle(node).animationDuration), {
        timeout: 1_000,
        message: 'primary 외부 윷은 2초 동안 천천히 정점까지 상승해야 합니다.',
      }).toBe('2s');
      await expect.poll(async () => firstPendingBody.evaluate((node) => getComputedStyle(node).animationDuration), {
        timeout: 1_000,
        message: 'primary body는 2초 동안 정확히 720도 회전해야 합니다.',
      }).toBe('2s');
      await expect.poll(async () => firstPendingStick.evaluate((node) => getComputedStyle(node).animationIterationCount), {
        timeout: 1_000,
        message: 'pending 외부 윷 비행은 무한 반복이 아니라 한 번만 실행되어야 합니다.',
      }).toBe('1');
      await expect.poll(async () => firstPendingBody.evaluate((node) => getComputedStyle(node).animationDelay), {
        timeout: 1_000,
        message: 'primary body 회전은 상승과 동시에 시작해야 합니다.',
      }).toBe('0s');
      await expect.poll(async () => page.locator('.roll-stage.pending-roll .roll-aura').evaluate((node) => getComputedStyle(node).animationDuration), {
        timeout: 1_000,
        message: 'pending aura 반복은 1.6초 주기로 늦춰져야 합니다.',
      }).toBe('1.6s');
      await expect.poll(async () => firstPendingStick.evaluate((node) => {
        const style = getComputedStyle(node);
        return `${style.getPropertyValue('--stick-depth').trim()}/${style.getPropertyValue('--stick-face-z').trim()}/${style.getPropertyValue('--stick-depth-offset').trim()}`;
      }), {
        timeout: 1_000,
        message: '확대 pending 윷은 overlay 전용 3D 두께 변수를 사용해야 합니다.',
      }).toBe('10px/5px/-5px');
      await expect.poll(async () => firstPendingBody.evaluate((node) => {
        const before = getComputedStyle(node, '::before');
        const after = getComputedStyle(node, '::after');
        return `${before.width}/${after.width}/${before.top}/${before.bottom}`;
      }), {
        timeout: 1_000,
        message: 'pending 윷 옆면 pseudo-element가 실제 overlay 두께값으로 렌더되어야 합니다.',
      }).toBe('10px/10px/6px/6px');
      await expect.poll(async () => firstPendingBody.evaluate((node) => {
        const flat = node.querySelector('.yut-stick-flat-face');
        const round = node.querySelector('.yut-stick-round-face');
        const readTranslateZ = (target) => {
          const values = getComputedStyle(target).transform.match(/matrix3d\(([^)]+)\)/)?.[1]?.split(',').map((value) => Number.parseFloat(value.trim())) ?? [];
          return values.length ? Math.round(values[14]) : null;
        };
        return `${readTranslateZ(flat)}/${readTranslateZ(round)}`;
      }), {
        timeout: 1_000,
        message: 'pending 윷 앞·뒷면은 같은 절댓값의 Z 두께 위치로 분리되어야 합니다.',
      }).toBe('5/-5');
      const pendingStickTransformAtStart = await firstPendingStick.evaluate((node) => getComputedStyle(node).transform);
      await page.waitForTimeout(700);
      const pendingStickTransformAtPeak = await firstPendingStick.evaluate((node) => getComputedStyle(node).transform);
      expect(pendingStickTransformAtPeak, 'pending 외부 윷은 아래 시작점에서 정점 좌표로 한 번 상승해야 합니다.').not.toBe(pendingStickTransformAtStart);
      await page.waitForTimeout(2_050);
      await expect(page.locator('.roll-stage.pending-roll.extra-spin-roll'), '서버 결과가 아직 없으면 1초 extra-spin을 이어가야 합니다.').toBeVisible({ timeout: 2_000 });
      await expect.poll(async () => firstPendingStick.evaluate((node) => getComputedStyle(node).animationDuration), {
        timeout: 1_000,
        message: 'extra-spin 외부 윷은 1초 회전 단위를 사용해야 합니다.',
      }).toBe('1s');
      await expect.poll(async () => firstPendingBody.evaluate((node) => getComputedStyle(node).animationIterationCount), {
        timeout: 1_000,
        message: 'extra-spin body는 결과 도착 전까지 정점 정지 없이 반복 회전해야 합니다.',
      }).toBe('infinite');
      const pendingTransformStart = await firstPendingBody.evaluate((node) => getComputedStyle(node).transform);
      await page.waitForTimeout(180);
      await expect.poll(async () => firstPendingBody.evaluate((node) => getComputedStyle(node).transform), {
        timeout: 1_000,
        message: 'pending 중 윷 내부 body의 3D transform이 계속 변해야 앞면/뒷면이 번갈아 보입니다.',
      }).not.toBe(pendingTransformStart);
      await expect(page.locator('.roll-stage.resolved-from-pending.landing-roll, .roll-stage.resolved-from-pending.result-hold-roll'), `서버 결과 도착 시 pending overlay를 같은 팝업의 landing/result-hold 단계로 이어서 전환해야 합니다: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 5_000 });
      if (await page.locator('.roll-stage.resolved-from-pending.landing-roll').isVisible().catch(() => false)) {
        await expect(page.locator('.roll-stage.resolved-from-pending.landing-roll .roll-label'), 'landing 단계에서는 결과명 공개 전이어야 합니다.').toHaveCount(0);
      }
      const resolvedFromPendingStartedAt = Date.now();
      await expect.poll(async () => {
        const sticks = await page.locator('.roll-stage.resolved-from-pending .yut-stick').evaluateAll((nodes) => nodes.map((node) => ({
          className: node.getAttribute('class') ?? '',
          animationName: getComputedStyle(node).animationName,
        })));
        if (sticks.length !== 4) return `sticks=${JSON.stringify(sticks)}`;

        const invalidStick = sticks.find((stick) => {
          const isFallen = stick.className.split(/\s+/).includes('fallen');
          return stick.animationName !== (isFallen ? 'yut-fall-flight' : 'yut-resolved-from-pending');
        });
        return invalidStick ? `sticks=${JSON.stringify(sticks)}` : 'ready';
      }, {
        timeout: 2_000,
        message: 'pending에서 확정된 윷은 낙 윷만 yut-fall-flight를 유지하고 나머지는 전용 착지 keyframe을 사용해야 합니다.',
      }).toBe('ready');
      await expect.poll(async () => page.locator('.roll-stage.resolved-from-pending .yut-stick').evaluateAll((nodes) => nodes.map((node) => {
        const body = node.querySelector('.yut-stick-body');
        const transform = body ? getComputedStyle(body).transform : '';
        const matrixValues = transform.match(/matrix3d\(([^)]+)\)/)?.[1]?.split(',').map((value) => Number.parseFloat(value.trim())) ?? [];
        const cosY = matrixValues.length ? matrixValues[0] : 1;
        return node.classList.contains('flat') ? cosY > 0.95 : node.classList.contains('round') ? cosY < -0.95 : false;
      }).every(Boolean)), {
        timeout: 2_000,
        message: 'authoritative 결과 후 각 윷은 flat/round 클래스에 맞는 3D 면으로 정지해야 합니다.',
      }).toBe(true);
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
      await expect.poll(async () => page.locator('.roll-stage.resolved-from-pending .yut-stick, .roll-stage.resolved-from-pending .yut-stick-body').evaluateAll((nodes) => {
        if (nodes.length !== 8) return `nodes=${nodes.length}`;
        const unfinished = nodes.map((node) => ({
          className: node.getAttribute('class') ?? '',
          states: node.getAnimations().map((animation) => animation.playState),
        })).filter((entry) => entry.states.some((state) => state !== 'finished'));
        return unfinished.length ? JSON.stringify(unfinished) : 'finished';
      }), {
        timeout: 1_000,
        message: '결과 label이 보이는 순간 모든 yut-stick과 yut-stick-body 애니메이션은 finished 상태여야 합니다.',
      }).toBe('finished');
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
      await page.waitForTimeout(1_800);
      await expect(page.locator('.roll-stage.resolved-from-pending .roll-stage-timing'), '타이밍 등급은 표시된 뒤 약 1.8초 후에도 유지되어야 합니다.').toHaveText(timingTextAfterReveal);
      await expect(resolvedLabel, '윷 결과명은 표시된 뒤 약 1.8초 후에도 유지되어야 합니다.').toHaveText(labelTextAfterReveal);
      const elapsedResolvedMs = Date.now() - resolvedFromPendingStartedAt;
      expect(elapsedResolvedMs, '결과 표시 유지 검증 후에도 resolved-from-pending 종료 기한이 남아 있어야 합니다.').toBeLessThan(4_700);
      await expect(page.locator('.roll-stage'), '확정 전 pending과 확정 후 overlay는 resolved-from-pending 시작 후 4.7초 이내 정상 종료되어야 합니다.').toBeHidden({ timeout: 4_700 - elapsedResolvedMs });
    });

    await runQaStep(testInfo, '말 이동 직후 preview 제거 확인', async () => {
      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.moveButton.visible && !state.moveButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 20_000, message: '윷 결과 적용 후 선택한 말 이동 버튼이 활성화되어야 합니다.' }).toBe('ready');

      await page.getByTestId('move-piece-button').click();
      await expect.poll(async () => page.locator('.board-node.route-preview').count(), {
        timeout: 2_000,
        message: '로컬 이동 애니메이션 종료 후 서버 확정 대기 중에는 예상 이동 경로가 없어야 합니다.',
      }).toBe(0);
    });
  });

  test('host가 대리 제출한 AI 이동은 sequence 경로로 칸별 재생되고 내 이동은 중복 재생되지 않는다', async ({ page, context }, testInfo) => {
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
      await page.getByTestId('roll-yut-button').click();
      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.moveButton.visible && !state.moveButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 20_000, message: '본인 말 이동 버튼이 활성화되어야 합니다.' }).toBe('ready');
      const stateBeforeLocalMove = await collectScreenState(page);
      const mutationIdsBeforeLocalMove = stateBeforeLocalMove.yutDebug?.actionPipeline?.localClientMutationIds;
      if (Array.isArray(mutationIdsBeforeLocalMove)) {
        for (const mutationId of mutationIdsBeforeLocalMove) {
          if (typeof mutationId === 'string' && mutationId.startsWith('move_piece_ai:')) knownAiMoveMutationIds.add(mutationId);
        }
      }
      await page.getByTestId('move-piece-button').click();
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 8_000, message: '본인 optimistic 이동 애니메이션이 시작되어야 합니다.' }).toBeGreaterThan(0);
      await expect.poll(async () => (await getMovingPieces()).length, { timeout: 12_000, message: '본인 optimistic 이동 애니메이션이 종료되어야 합니다.' }).toBe(0);
      await page.waitForTimeout(1_200);
      expect(await getMovingPieces(), '서버 sequence 확정 후 본인 말 이동이 다시 재생되면 안 됩니다.').toEqual([]);
    });

    await runQaStep(testInfo, 'AI 대리 제출 이동은 authoritative 이동 칸 수에 맞게 재생됨', async () => {
      const observedPositions = new Set();
      await expect.poll(async () => {
        const moving = await getMovingPieces();
        for (const piece of moving) {
          if (!piece.isLocalOwner) observedPositions.add(`${piece.testId}:${piece.left},${piece.top}`);
        }

        const state = await collectScreenState(page);
        const mutationIds = state.yutDebug?.actionPipeline?.localClientMutationIds;
        const latestAiMoveMutationId = Array.isArray(mutationIds)
          ? [...mutationIds].reverse().find((mutationId) => (
            typeof mutationId === 'string'
            && mutationId.startsWith('move_piece_ai:')
            && !knownAiMoveMutationIds.has(mutationId)
          )) ?? ''
          : '';
        const aiMoveSteps = Number(latestAiMoveMutationId.split(':')[6]);
        const requiredPositions = Number.isFinite(aiMoveSteps)
          ? Math.min(2, Math.max(1, Math.abs(aiMoveSteps)))
          : 2;

        if (latestAiMoveMutationId && observedPositions.size >= requiredPositions) return 'animated';
        return `requiredPositions=${requiredPositions} aiMoveSteps=${Number.isFinite(aiMoveSteps) ? aiMoveSteps : 'unknown'} mutation=${latestAiMoveMutationId || 'pending'} positions=${Array.from(observedPositions).join('|')} state=${JSON.stringify(state.yutDebug ?? {}, null, 2)}`;
      }, {
        timeout: 70_000,
        intervals: [100, 150, 200, 250],
        message: 'AI 이동은 1칸이면 moving 상태가 관찰되고, 2칸 이상이면 최소 2개 칸 위치를 거쳐야 합니다.',
      }).toBe('animated');
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
