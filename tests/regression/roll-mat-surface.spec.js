import { test, expect } from '@playwright/test';
import { collectScreenState, expectAppShell, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('roll mat surface regression', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('pending부터 결과 유지까지 축소된 2D 매트 표면과 충분한 3D viewport를 계속 표시한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'mat-host'));
    const roomTitle = makeQaName(testInfo, 'mat-room');
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

    await runQaStep(testInfo, '축소된 매트 표면과 3D viewport 확인', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '매트 회귀를 확인할 수 있는 내 차례 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');

      await page.getByTestId('roll-yut-button').click();
      const mat = page.getByTestId('roll-mat');
      const surface = page.getByTestId('roll-mat-surface');
      const pendingStage = page.locator('.roll-stage.pending-roll');
      const pendingScene = pendingStage.getByTestId('yut-roll-scene');
      await expect(pendingStage).toBeVisible({ timeout: 500 });
      await expect(mat).toBeVisible();
      await expect(surface).toBeVisible();
      await expect(pendingScene).toBeVisible();

      const sceneLayout = await pendingScene.evaluate((node) => {
        const sceneRect = node.getBoundingClientRect();
        const canvas = node.querySelector('.yut-roll-three-canvas');
        const canvasRect = canvas?.getBoundingClientRect();
        const stage = node.closest('.roll-stage');
        const matNode = node.closest('[data-testid="roll-mat"]');
        const matRect = matNode?.getBoundingClientRect();
        return {
          sceneWidth: Math.round(sceneRect.width),
          sceneHeight: Math.round(sceneRect.height),
          canvasWidth: Math.round(canvasRect?.width ?? 0),
          canvasHeight: Math.round(canvasRect?.height ?? 0),
          matWidth: Math.round(matRect?.width ?? 0),
          matHeight: Math.round(matRect?.height ?? 0),
          stageContain: stage ? getComputedStyle(stage).contain : '',
          viewportWidth: window.innerWidth,
        };
      });
      expect(sceneLayout.sceneWidth).toBeLessThanOrEqual(sceneLayout.viewportWidth);
      expect(sceneLayout.sceneWidth).toBeGreaterThanOrEqual(360);
      expect(sceneLayout.sceneHeight).toBeGreaterThanOrEqual(320);
      expect(sceneLayout.canvasWidth).toBe(sceneLayout.sceneWidth);
      expect(sceneLayout.canvasHeight).toBe(sceneLayout.sceneHeight);
      expect(sceneLayout.matWidth).toBeGreaterThan(0);
      expect(sceneLayout.matHeight).toBeGreaterThanOrEqual(360);
      expect(sceneLayout.stageContain.split(/\s+/)).not.toContain('paint');

      await page.evaluate(() => {
        window.__YUT_QA_ROLL_MAT_NODE__ = document.querySelector('[data-testid="roll-mat"]');
        window.__YUT_QA_ROLL_MAT_SURFACE_NODE__ = document.querySelector('[data-testid="roll-mat-surface"]');
        window.__YUT_QA_ROLL_SCENE_NODE__ = document.querySelector('[data-testid="yut-roll-scene"]');
      });

      const readSurfaceState = () => surface.evaluate((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          backgroundImage: style.backgroundImage,
          borderTopWidth: style.borderTopWidth,
          borderTopStyle: style.borderTopStyle,
          boxShadow: style.boxShadow,
          opacity: style.opacity,
          layoutWidth: node.offsetWidth,
          layoutHeight: node.offsetHeight,
          visualWidth: Math.round(rect.width),
          visualHeight: Math.round(rect.height),
        };
      });

      const pendingSurface = await readSurfaceState();
      expect(pendingSurface.backgroundImage).not.toBe('none');
      expect(pendingSurface.borderTopWidth).toBe('10px');
      expect(pendingSurface.borderTopStyle).toBe('solid');
      expect(pendingSurface.boxShadow).not.toBe('none');
      expect(pendingSurface.opacity).toBe('1');
      expect(pendingSurface.layoutWidth).toBeGreaterThan(0);
      expect(pendingSurface.layoutHeight).toBeGreaterThan(0);
      expect(pendingSurface.visualWidth).toBeGreaterThan(0);
      expect(pendingSurface.visualHeight).toBeGreaterThan(0);
      expect(pendingSurface.visualWidth).toBeLessThan(sceneLayout.sceneWidth);
      expect(pendingSurface.visualWidth).toBeLessThanOrEqual(Math.round(sceneLayout.viewportWidth * 0.9));
      expect(pendingSurface.visualHeight).toBeLessThan(sceneLayout.matHeight);

      await expect(page.locator('.roll-stage.resolved-from-pending.landing-roll, .roll-stage.resolved-from-pending.result-hold-roll')).toBeVisible({ timeout: 8_000 });
      await expect.poll(() => page.evaluate(() => (
        window.__YUT_QA_ROLL_MAT_NODE__ === document.querySelector('[data-testid="roll-mat"]')
        && window.__YUT_QA_ROLL_MAT_SURFACE_NODE__ === document.querySelector('[data-testid="roll-mat-surface"]')
        && window.__YUT_QA_ROLL_SCENE_NODE__ === document.querySelector('[data-testid="yut-roll-scene"]')
      )), {
        timeout: 1_000,
        message: 'pending에서 landing/result-hold로 전환할 때 매트, 표면, 3D 장면 DOM을 교체하면 안 됩니다.',
      }).toBe(true);

      const resolvedSurface = await readSurfaceState();
      expect(resolvedSurface.backgroundImage).not.toBe('none');
      expect(resolvedSurface.borderTopWidth).toBe('10px');
      expect(resolvedSurface.borderTopStyle).toBe('solid');
      expect(resolvedSurface.boxShadow).not.toBe('none');
      expect(resolvedSurface.opacity).toBe('1');
      expect(resolvedSurface.layoutWidth).toBe(pendingSurface.layoutWidth);
      expect(resolvedSurface.layoutHeight).toBe(pendingSurface.layoutHeight);
      expect(resolvedSurface.visualWidth).toBeGreaterThan(0);
      expect(resolvedSurface.visualHeight).toBeGreaterThan(0);

      await expect(page.locator('.roll-stage.resolved-from-pending .roll-label')).toBeVisible({ timeout: 5_000 });
      await expect(surface).toBeVisible();
      const heldSurface = await readSurfaceState();
      expect(heldSurface.backgroundImage).not.toBe('none');
      expect(heldSurface.borderTopWidth).toBe('10px');
      expect(heldSurface.boxShadow).not.toBe('none');
      expect(heldSurface.opacity).toBe('1');
      expect(heldSurface.layoutWidth).toBe(pendingSurface.layoutWidth);
      expect(heldSurface.layoutHeight).toBe(pendingSurface.layoutHeight);
      expect(heldSurface.visualWidth).toBeGreaterThan(0);
      expect(heldSurface.visualHeight).toBeGreaterThan(0);
    });
  });
});
