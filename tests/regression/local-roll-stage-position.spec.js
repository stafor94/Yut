import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

const readRollGeometry = async (page) => page.evaluate(() => {
  const board = document.querySelector('[data-testid="game-board"]');
  const stage = document.querySelector('.roll-stage');
  const mat = document.querySelector('[data-testid="roll-mat"]');
  const grade = document.querySelector('[data-testid="roll-timing-grade"]');
  const resultPresentation = document.querySelector('[data-testid="roll-result-presentation"]');
  const resultCard = document.querySelector('[data-testid="roll-result-card"]');
  const surface = document.querySelector('[data-testid="roll-mat-surface"]');
  if (!board || !stage || !mat || !grade) return null;

  const centerX = (rect) => rect.left + rect.width / 2;
  const boardRect = board.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const matRect = mat.getBoundingClientRect();
  const gradeRect = grade.getBoundingClientRect();
  const stageStyle = getComputedStyle(stage);
  const gradeStyle = getComputedStyle(grade);
  const resultStyle = resultPresentation ? getComputedStyle(resultPresentation) : null;
  const cardRect = resultCard?.getBoundingClientRect() ?? null;
  const surfaceRect = surface?.getBoundingClientRect() ?? null;

  return {
    anchored: stage.getAttribute('data-board-anchored'),
    stageCenterOffset: Math.abs(centerX(stageRect) - centerX(boardRect)),
    matCenterOffset: Math.abs(centerX(matRect) - centerX(boardRect)),
    gradeCenterOffset: Math.abs(centerX(gradeRect) - centerX(boardRect)),
    resultCenterOffset: cardRect ? Math.abs(centerX(cardRect) - centerX(boardRect)) : null,
    stageWidth: stageRect.width,
    matWidth: matRect.width,
    stageTranslate: stageStyle.translate,
    stageJustifyContent: stageStyle.justifyContent,
    gradeTop: Number.parseFloat(gradeStyle.top),
    resultTop: resultStyle ? Number.parseFloat(resultStyle.top) : null,
    gradeResultGap: cardRect ? cardRect.top - gradeRect.bottom : null,
    resultSurfaceGap: cardRect && surfaceRect ? surfaceRect.top - cardRect.bottom : null,
  };
});

test.describe('local roll stage position regression', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('내가 던질 때 매트와 결과를 윷판 중앙에 유지하고 결과 묶음을 매트 가까이 표시한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'position-host'));
    const roomTitle = makeQaName(testInfo, 'position-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3500;
    });

    await runQaStep(testInfo, 'AI 게임 시작 후 내 윷 던지기 대기', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '내 차례 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');
    });

    await runQaStep(testInfo, 'pending 매트 중앙 정렬 확인', async () => {
      await page.getByTestId('roll-yut-button').click();
      await expect(page.locator('.roll-stage.pending-roll')).toBeVisible({ timeout: 2_000 });
      await expect(page.getByTestId('roll-mat')).toBeVisible();
      await expect(page.getByTestId('roll-timing-grade')).toBeAttached();

      const geometry = await readRollGeometry(page);
      expect(geometry, '윷 던지기 위치 요소를 모두 찾을 수 있어야 합니다.').not.toBeNull();
      if (!geometry) throw new Error('윷 던지기 위치 요소를 찾지 못했습니다.');
      expect(geometry.anchored).toBe('true');
      expect(geometry.stageCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.matCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.gradeCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.stageWidth).toBeGreaterThanOrEqual(geometry.matWidth - 1);
      expect(geometry.stageTranslate).not.toBe('none');
      expect(geometry.stageJustifyContent).toBe('center');
    });

    await runQaStep(testInfo, '결과 카드 중앙 정렬과 매트 간격 확인', async () => {
      const resultCard = page.getByTestId('roll-result-card');
      await expect(resultCard).toBeVisible({ timeout: 10_000 });
      await resultCard.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      });
      const geometry = await readRollGeometry(page);
      expect(geometry, '결과 표시 위치 요소를 모두 찾을 수 있어야 합니다.').not.toBeNull();
      if (!geometry) throw new Error('결과 표시 위치 요소를 찾지 못했습니다.');

      expect(geometry.stageCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.matCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.gradeCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.resultCenterOffset).not.toBeNull();
      expect(geometry.resultCenterOffset).toBeLessThanOrEqual(2);
      expect(geometry.stageWidth).toBeGreaterThanOrEqual(geometry.matWidth - 1);
      expect(geometry.gradeTop).toBe(20);
      expect(geometry.resultTop).toBe(55);
      expect(geometry.gradeResultGap).toBeGreaterThanOrEqual(0);
      expect(geometry.gradeResultGap).toBeLessThanOrEqual(8);
      expect(geometry.resultSurfaceGap).toBeLessThanOrEqual(100);
    });
  });
});
