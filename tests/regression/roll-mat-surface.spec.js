import { test, expect } from '@playwright/test';
import { collectScreenState, createRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';
import { makeQaName, normalizeQaNickname } from '../helpers/env.js';
import { deleteRoomForQa, findRoomIdByTitle, rememberRoomIdFromPage } from '../helpers/rooms.js';

test.describe('roll mat surface regression', () => {
  let roomId;

  test.afterEach(async () => {
    await deleteRoomForQa(roomId).catch(() => undefined);
  });

  test('원목 게임 UI와 pending부터 결과 유지까지 축소된 매트를 계속 표시한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    const hostName = normalizeQaNickname(makeQaName(testInfo, 'mat-host'));
    const roomTitle = makeQaName(testInfo, 'mat-room');
    await primeLobbyStorage(context, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });
    await context.addInitScript(() => {
      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3500;
    });

    await runQaStep(testInfo, 'AI 게임 시작', async () => {
      await createRoomFromLobby(page, roomTitle);
      roomId = await rememberRoomIdFromPage(page) ?? await findRoomIdByTitle(roomTitle);
      const addAiButton = page.getByTestId('add-ai-P2');
      if (await addAiButton.isVisible().catch(() => false)) await addAiButton.click();
      await expect(page.getByTestId('start-game-button')).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId('start-game-button').click();
      await expect(page.getByTestId('game-screen'), `게임 화면 진입 실패: ${JSON.stringify(await collectScreenState(page), null, 2)}`).toBeVisible({ timeout: 25_000 });
    });

    await runQaStep(testInfo, '원목 UI와 축소된 매트 표면 확인', async () => {
      await expect.poll(async () => {
        const state = await collectScreenState(page);
        if (state.rollButton.visible && !state.rollButton.disabled) return 'ready';
        return JSON.stringify(state, null, 2);
      }, { timeout: 45_000, message: '매트 회귀를 확인할 수 있는 내 차례 윷 던지기 버튼이 활성화되어야 합니다.' }).toBe('ready');

      const board = page.getByTestId('game-board');
      const turnIndicator = page.getByTestId('turn-indicator');
      const controls = page.locator('.play-controls');
      const timingMeter = page.locator('.roll-timing-meter');
      const rollButton = page.getByTestId('roll-yut-button');
      await expect(board).toBeVisible();
      await expect(turnIndicator).toBeVisible();
      await expect(controls).toBeVisible();
      await expect(timingMeter).toBeVisible();
      await expect(rollButton).toBeVisible();
      await expect(page.locator('.board-node')).toHaveCount(29);

      const woodenUi = await page.evaluate(() => {
        const boardNode = document.querySelector('[data-testid="game-board"]');
        const routeLine = boardNode?.querySelector('.board-route-lines line');
        const normalNode = boardNode?.querySelector('.board-node.normal');
        const centerNode = boardNode?.querySelector('[data-testid="board-node-c01"]');
        const startNode = boardNode?.querySelector('[data-testid="board-node-n01"]');
        const turnNode = document.querySelector('[data-testid="turn-indicator"]');
        const controlNode = document.querySelector('.play-controls');
        const meterNode = document.querySelector('.roll-timing-meter');
        const buttonNode = document.querySelector('[data-testid="roll-yut-button"]');
        if (!boardNode || !routeLine || !normalNode || !centerNode || !startNode || !turnNode || !controlNode || !meterNode || !buttonNode) return null;

        const boardStyle = getComputedStyle(boardNode);
        const routeStyle = getComputedStyle(routeLine);
        const normalStyle = getComputedStyle(normalNode);
        const centerStyle = getComputedStyle(centerNode);
        const startStyle = getComputedStyle(startNode);
        const turnStyle = getComputedStyle(turnNode);
        const controlStyle = getComputedStyle(controlNode);
        const meterStyle = getComputedStyle(meterNode);
        const buttonStyle = getComputedStyle(buttonNode);
        const boardRect = boardNode.getBoundingClientRect();
        const turnRect = turnNode.getBoundingClientRect();
        const controlRect = controlNode.getBoundingClientRect();
        const buttonRect = buttonNode.getBoundingClientRect();

        return {
          viewportWidth: window.innerWidth,
          boardWidth: boardRect.width,
          turnWidth: turnRect.width,
          controlWidth: controlRect.width,
          buttonHeight: buttonRect.height,
          boardBackground: boardStyle.backgroundImage,
          boardBorderStyle: boardStyle.borderTopStyle,
          boardBorderWidth: Number.parseFloat(boardStyle.borderTopWidth),
          boardShadow: boardStyle.boxShadow,
          routeDash: routeStyle.strokeDasharray,
          routeWidth: Number.parseFloat(routeStyle.strokeWidth),
          normalBackground: normalStyle.backgroundImage,
          normalShadow: normalStyle.boxShadow,
          centerBackground: centerStyle.backgroundImage,
          startBackground: startStyle.backgroundImage,
          turnBackground: turnStyle.backgroundImage,
          turnBorderWidth: Number.parseFloat(turnStyle.borderTopWidth),
          turnShadow: turnStyle.boxShadow,
          controlBackground: controlStyle.backgroundImage,
          controlBorderWidth: Number.parseFloat(controlStyle.borderTopWidth),
          controlShadow: controlStyle.boxShadow,
          meterBackground: meterStyle.backgroundImage,
          meterHeight: Number.parseFloat(meterStyle.height),
          buttonBackground: buttonStyle.backgroundImage,
          buttonBorderWidth: Number.parseFloat(buttonStyle.borderTopWidth),
          buttonShadow: buttonStyle.boxShadow,
        };
      });

      expect(woodenUi, '원목 게임 UI 구성 요소를 모두 찾을 수 있어야 합니다.').not.toBeNull();
      if (!woodenUi) throw new Error('원목 게임 UI 구성 요소를 찾지 못했습니다.');
      expect(woodenUi.boardWidth).toBeLessThanOrEqual(woodenUi.viewportWidth);
      expect(woodenUi.turnWidth).toBeLessThanOrEqual(woodenUi.viewportWidth);
      expect(woodenUi.controlWidth).toBeLessThanOrEqual(woodenUi.viewportWidth);
      expect(woodenUi.buttonHeight).toBeGreaterThanOrEqual(52);
      expect(woodenUi.boardBackground).not.toBe('none');
      expect(woodenUi.boardBorderStyle).toBe('solid');
      expect(woodenUi.boardBorderWidth).toBeGreaterThanOrEqual(9);
      expect(woodenUi.boardShadow).not.toBe('none');
      expect(woodenUi.routeDash).toBe('none');
      expect(woodenUi.routeWidth).toBeGreaterThanOrEqual(1.8);
      expect(woodenUi.normalBackground).not.toBe('none');
      expect(woodenUi.normalShadow).not.toBe('none');
      expect(woodenUi.centerBackground).not.toBe('none');
      expect(woodenUi.startBackground).not.toBe('none');
      expect(woodenUi.turnBackground).not.toBe('none');
      expect(woodenUi.turnBorderWidth).toBeGreaterThanOrEqual(2);
      expect(woodenUi.turnShadow).not.toBe('none');
      expect(woodenUi.controlBackground).not.toBe('none');
      expect(woodenUi.controlBorderWidth).toBeGreaterThanOrEqual(7);
      expect(woodenUi.controlShadow).not.toBe('none');
      expect(woodenUi.meterBackground).not.toBe('none');
      expect(woodenUi.meterHeight).toBeGreaterThanOrEqual(12);
      expect(woodenUi.buttonBackground).not.toBe('none');
      expect(woodenUi.buttonBorderWidth).toBeGreaterThanOrEqual(2);
      expect(woodenUi.buttonShadow).not.toBe('none');

      await page.getByTestId('roll-yut-button').click();
      const mat = page.getByTestId('roll-mat');
      const surface = page.getByTestId('roll-mat-surface');
      const pendingStage = page.locator('.roll-stage.pending-roll');
      const pendingScene = pendingStage.getByTestId('yut-roll-scene');
      await expect(pendingStage).toBeVisible({ timeout: 2_000 });
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
          sceneLayoutWidth: node.offsetWidth,
          sceneLayoutHeight: node.offsetHeight,
          canvasWidth: Math.round(canvasRect?.width ?? 0),
          canvasHeight: Math.round(canvasRect?.height ?? 0),
          canvasLayoutWidth: canvas?.offsetWidth ?? 0,
          canvasLayoutHeight: canvas?.offsetHeight ?? 0,
          matWidth: Math.round(matRect?.width ?? 0),
          matHeight: Math.round(matRect?.height ?? 0),
          matLayoutWidth: matNode?.offsetWidth ?? 0,
          matLayoutHeight: matNode?.offsetHeight ?? 0,
          stageContain: stage ? getComputedStyle(stage).contain : '',
          viewportWidth: window.innerWidth,
        };
      });
      expect(sceneLayout.sceneLayoutWidth).toBeLessThanOrEqual(sceneLayout.viewportWidth);
      expect(sceneLayout.sceneLayoutWidth).toBeGreaterThanOrEqual(360);
      expect(sceneLayout.sceneLayoutHeight).toBeGreaterThanOrEqual(320);
      expect(sceneLayout.canvasLayoutWidth).toBe(sceneLayout.sceneLayoutWidth);
      expect(sceneLayout.canvasLayoutHeight).toBe(sceneLayout.sceneLayoutHeight);
      expect(sceneLayout.sceneWidth).toBeGreaterThan(0);
      expect(sceneLayout.sceneHeight).toBeGreaterThan(0);
      expect(sceneLayout.canvasWidth).toBe(sceneLayout.sceneWidth);
      expect(sceneLayout.canvasHeight).toBe(sceneLayout.sceneHeight);
      expect(sceneLayout.matWidth).toBeGreaterThan(0);
      expect(sceneLayout.matHeight).toBeGreaterThan(0);
      expect(sceneLayout.matLayoutWidth).toBeGreaterThan(0);
      expect(sceneLayout.matLayoutHeight).toBeGreaterThanOrEqual(360);
      expect(sceneLayout.stageContain.split(/\s+/)).not.toContain('paint');

      await page.evaluate(() => {
        window.__YUT_QA_ROLL_MAT_NODE__ = document.querySelector('[data-testid="roll-mat"]');
        window.__YUT_QA_ROLL_MAT_SURFACE_NODE__ = document.querySelector('[data-testid="roll-mat-surface"]');
        window.__YUT_QA_ROLL_SCENE_NODE__ = document.querySelector('[data-testid="yut-roll-scene"]');
      });

      const readSurfaceState = () => surface.evaluate((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const matNode = node.closest('[data-testid="roll-mat"]');
        const sceneNode = matNode?.querySelector('[data-testid="yut-roll-scene"]');
        if (!sceneNode) throw new Error('윷 매트 내부의 3D 장면을 찾지 못했습니다.');
        const sceneRect = sceneNode.getBoundingClientRect();
        return {
          backgroundImage: style.backgroundImage,
          borderTopWidth: style.borderTopWidth,
          borderTopStyle: style.borderTopStyle,
          boxShadow: style.boxShadow,
          opacity: style.opacity,
          layoutWidth: node.offsetWidth,
          layoutHeight: node.offsetHeight,
          visualInsetTop: Math.round(rect.top - sceneRect.top),
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
      expect(pendingSurface.layoutWidth).toBeLessThanOrEqual(Math.round(sceneLayout.viewportWidth * 0.64));
      expect(pendingSurface.visualHeight).toBeLessThanOrEqual(270);
      expect(pendingSurface.visualInsetTop).toBeGreaterThanOrEqual(50);
      expect(pendingSurface.visualWidth).toBeLessThan(sceneLayout.sceneWidth);
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
