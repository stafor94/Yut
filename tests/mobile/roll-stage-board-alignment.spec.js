import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('mobile roll stage board alignment QA', () => {
  test('내 윷 던지기 매트와 결과를 윷판 중앙에 두고 등급·결과를 매트 가까이 배치한다', async ({ page, context }, testInfo) => {
    await primeLobbyStorage(context, { nickname: '매트정렬QA' });

    await runQaStep(testInfo, '실제 윷 던지기 DOM 구조의 모바일 위치 계약 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const geometry = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'game-shell';
        host.style.cssText = 'position:relative;width:100%;min-height:560px;';
        host.innerHTML = `
          <section class="panel board-panel" style="position:relative;width:100%;height:520px;">
            <div data-testid="game-board" class="board" style="width:320px;height:320px;"></div>
            <div class="roll-stage resolved-from-pending result-hold-roll" data-board-anchored="true" style="inset:auto;top:0;left:37px;width:320px;height:320px;">
              <div data-testid="roll-mat" class="roll-mat">
                <span data-testid="roll-mat-surface" class="roll-mat-surface" aria-hidden="true">
                  <span class="roll-mat-depth"></span>
                  <span class="roll-mat-inlay"></span>
                </span>
                <span data-testid="roll-timing-grade" class="roll-timing-feedback roll-stage-timing transient nice">NICE</span>
                <div data-testid="roll-result-presentation" class="roll-result-presentation">
                  <span data-testid="roll-result-card" class="roll-label roll-result-card standard">
                    <strong class="roll-result-name"><span>개</span></strong>
                    <small class="roll-result-description">2칸 이동</small>
                  </span>
                </div>
                <div data-testid="yut-roll-scene" class="yut-roll-scene"></div>
              </div>
            </div>
          </section>
        `;
        document.body.append(host);

        const panel = host.querySelector('.board-panel');
        const board = host.querySelector('[data-testid="game-board"]');
        const stage = host.querySelector('.roll-stage');
        const mat = host.querySelector('[data-testid="roll-mat"]');
        const grade = host.querySelector('[data-testid="roll-timing-grade"]');
        const resultPresentation = host.querySelector('[data-testid="roll-result-presentation"]');
        const card = host.querySelector('[data-testid="roll-result-card"]');
        const surface = host.querySelector('[data-testid="roll-mat-surface"]');
        if (!panel || !board || !stage || !mat || !grade || !resultPresentation || !card || !surface) throw new Error('모바일 윷 던지기 fixture 생성에 실패했습니다.');

        const centerX = (rect) => rect.left + rect.width / 2;
        const panelRect = panel.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const matRect = mat.getBoundingClientRect();
        const gradeRect = grade.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        const stageStyle = getComputedStyle(stage);
        const gradeStyle = getComputedStyle(grade);
        const resultStyle = getComputedStyle(resultPresentation);
        const result = {
          viewportWidth: window.innerWidth,
          panelCenterOffset: Math.abs(centerX(panelRect) - centerX(boardRect)),
          stageCenterOffset: Math.abs(centerX(stageRect) - centerX(boardRect)),
          matCenterOffset: Math.abs(centerX(matRect) - centerX(boardRect)),
          gradeCenterOffset: Math.abs(centerX(gradeRect) - centerX(boardRect)),
          resultCenterOffset: Math.abs(centerX(cardRect) - centerX(boardRect)),
          stageWidth: stageRect.width,
          matWidth: matRect.width,
          stageLeft: Number.parseFloat(stageStyle.left),
          stageTranslate: stageStyle.translate,
          stageJustifyContent: stageStyle.justifyContent,
          gradeTop: Number.parseFloat(gradeStyle.top),
          resultTop: Number.parseFloat(resultStyle.top),
          gradeResultGap: cardRect.top - gradeRect.bottom,
          resultSurfaceGap: surfaceRect.top - cardRect.bottom,
        };
        host.remove();
        return result;
      });

      expect(geometry.panelCenterOffset).toBeLessThanOrEqual(1);
      expect(geometry.stageCenterOffset).toBeLessThanOrEqual(1);
      expect(geometry.matCenterOffset).toBeLessThanOrEqual(1);
      expect(geometry.gradeCenterOffset).toBeLessThanOrEqual(1);
      expect(geometry.resultCenterOffset).toBeLessThanOrEqual(1);
      expect(geometry.stageWidth).toBeGreaterThanOrEqual(geometry.matWidth - 1);
      expect(geometry.stageLeft).toBeGreaterThan(0);
      expect(geometry.stageTranslate).not.toBe('none');
      expect(geometry.stageJustifyContent).toBe('center');
      expect(geometry.gradeTop).toBe(20);
      expect(geometry.resultTop).toBe(49.5);
      expect(geometry.gradeResultGap).toBeGreaterThanOrEqual(0);
      expect(geometry.gradeResultGap).toBeLessThanOrEqual(8);
      expect(geometry.resultSurfaceGap).toBeLessThanOrEqual(100);
      expect(geometry.viewportWidth).toBeGreaterThan(0);
    });
  });
});
