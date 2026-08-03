export async function verifyMovePreviewRemoval({
  page,
  testInfo,
  expect,
  collectScreenState,
  runQaStep,
  clickSequenceRollAtPerfect,
}) {
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

    await page.evaluate(() => {
      window.__YUT_QA_MOVE_PREVIEW_OBSERVER__?.disconnect();
      if (window.__YUT_QA_MOVE_PREVIEW_FRAME__) {
        cancelAnimationFrame(window.__YUT_QA_MOVE_PREVIEW_FRAME__);
      }
      const initialPreviewCount = document.querySelectorAll('.board-node.route-preview').length;
      window.__YUT_QA_MOVE_PREVIEW_FLOW__ = {
        initialPreviewCount,
        previewCount: initialPreviewCount,
        movingCount: 0,
        buttonActionable: true,
        started: false,
        sawMoving: false,
        completed: false,
      };

      let observer;
      const sample = () => {
        const flow = window.__YUT_QA_MOVE_PREVIEW_FLOW__;
        if (!flow) return false;
        const previewCount = document.querySelectorAll('.board-node.route-preview').length;
        const movingCount = document.querySelectorAll('.piece-token.moving').length;
        const button = document.querySelector('[data-testid="move-piece-button"]');
        const buttonActionable = button instanceof HTMLButtonElement
          && button.isConnected
          && !button.disabled;
        const sawMoving = flow.sawMoving || movingCount > 0;
        const started = flow.started
          || movingCount > 0
          || previewCount < flow.initialPreviewCount
          || !buttonActionable;
        const completed = started
          && previewCount === 0
          && movingCount === 0
          && !buttonActionable;
        window.__YUT_QA_MOVE_PREVIEW_FLOW__ = {
          ...flow,
          previewCount,
          movingCount,
          buttonActionable,
          started,
          sawMoving,
          completed,
        };
        if (!completed) return false;
        observer?.disconnect();
        if (window.__YUT_QA_MOVE_PREVIEW_FRAME__) {
          cancelAnimationFrame(window.__YUT_QA_MOVE_PREVIEW_FRAME__);
          window.__YUT_QA_MOVE_PREVIEW_FRAME__ = 0;
        }
        return true;
      };
      const tick = () => {
        if (sample()) return;
        window.__YUT_QA_MOVE_PREVIEW_FRAME__ = requestAnimationFrame(tick);
      };
      observer = new MutationObserver(sample);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'disabled', 'style'],
        childList: true,
        subtree: true,
      });
      window.__YUT_QA_MOVE_PREVIEW_OBSERVER__ = observer;
      tick();
    });

    const moveButton = page.getByTestId('move-piece-button');
    if (await moveButton.isVisible().catch(() => false) && await moveButton.isEnabled().catch(() => false)) {
      await moveButton.click({ timeout: 2_000 }).catch(async (error) => {
        const started = await page.evaluate(() => window.__YUT_QA_MOVE_PREVIEW_FLOW__?.started ?? false);
        if (!started) throw error;
      });
    }

    let moveFlow = null;
    await expect.poll(async () => {
      moveFlow = await page.evaluate(() => window.__YUT_QA_MOVE_PREVIEW_FLOW__ ?? null);
      return moveFlow?.completed ?? false;
    }, {
      timeout: 10_000,
      message: '수동 또는 자동 이동이 실제 시작·종료되고 예상 이동 경로가 제거되어야 합니다.',
    }).toBe(true);
    if (!moveFlow) throw new Error('이동 lifecycle snapshot을 수집하지 못했습니다.');
    expect(moveFlow.started, '이동 버튼 상호작용 뒤 실제 이동 상태 전환이 시작되어야 합니다.').toBe(true);
    expect(moveFlow.previewCount, '로컬 이동 종료 후 예상 이동 경로가 없어야 합니다.').toBe(0);
    expect(moveFlow.movingCount, '로컬 이동 애니메이션이 종료되어야 합니다.').toBe(0);
    expect(moveFlow.buttonActionable, '이동 처리 중 같은 이동 버튼을 다시 실행할 수 없어야 합니다.').toBe(false);
  });
}
