import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('mobile lobby polish QA', () => {
  test('로비 배경과 액션이 하나의 영역으로 이어지고 모바일 버튼 크기를 유지한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '모바일로비QA' });

    await runQaStep(testInfo, '모바일 로비 연속 배경과 액션 크기 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const layout = await page.evaluate(() => {
        const stage = document.querySelector('.lobby-stage');
        const scene = document.querySelector('.lobby-scene');
        const primary = document.querySelector('.lobby-primary-actions');
        const create = document.querySelector('[aria-label="방 만들기"]');
        const join = document.querySelector('[aria-label="게임 참가"]');
        const secondary = document.querySelector('.lobby-secondary-actions');
        const secondaryButtons = Array.from(document.querySelectorAll('.lobby-secondary-actions button'));
        if (!(stage instanceof HTMLElement) || !(scene instanceof HTMLElement) || !(primary instanceof HTMLElement) || !(create instanceof HTMLElement) || !(join instanceof HTMLElement) || !(secondary instanceof HTMLElement) || secondaryButtons.length !== 2) return null;
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const stageStyle = getComputedStyle(stage);
        const sceneStyle = getComputedStyle(scene);
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
          stage: rect(stage),
          scene: rect(scene),
          primary: rect(primary),
          create: rect(create),
          join: rect(join),
          secondary: rect(secondary),
          secondaryButtons: secondaryButtons.map((button) => {
            const style = getComputedStyle(button);
            const svg = button.querySelector('svg');
            return {
              ...rect(button),
              fontSize: Number.parseFloat(style.fontSize),
              svg: svg instanceof SVGElement ? rect(svg) : null,
            };
          }),
          stageBackground: stageStyle.backgroundImage,
          stageOverflow: stageStyle.overflow,
          sceneBorderWidth: Number.parseFloat(sceneStyle.borderTopWidth),
          sceneBoxShadow: sceneStyle.boxShadow,
        };
      });

      expect(layout, '모바일 로비 통합 영역을 읽을 수 있어야 합니다.').not.toBeNull();
      expect(layout.scrollHeight, '로비는 세로 스크롤을 만들면 안 됩니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(layout.stageBackground, '장면과 버튼 뒤에 이어지는 배경이 있어야 합니다.').toContain('gradient');
      expect(layout.stageOverflow, '통합 배경은 둥근 프레임 안에서 잘려야 합니다.').toBe('hidden');
      expect(layout.sceneBorderWidth, '장면과 버튼 사이에 별도 테두리가 있으면 안 됩니다.').toBe(0);
      expect(layout.sceneBoxShadow, '장면만 별도 카드처럼 보이는 그림자가 있으면 안 됩니다.').toBe('none');
      expect(layout.create.x, '방 만들기 버튼은 통합 배경 안에 있어야 합니다.').toBeGreaterThanOrEqual(layout.stage.x);
      expect(layout.join.right, '방 참가 버튼은 통합 배경 안에 있어야 합니다.').toBeLessThanOrEqual(layout.stage.right);
      expect(layout.secondary.bottom, '보조 버튼도 통합 배경 안에 있어야 합니다.').toBeLessThanOrEqual(layout.stage.bottom + 1);
      expect(layout.primary.width / layout.viewportWidth, '주요 버튼 영역은 화면 너비의 약 80%여야 합니다.').toBeGreaterThanOrEqual(.78);
      expect(layout.primary.width / layout.viewportWidth, '주요 버튼 영역은 화면 너비의 약 80%여야 합니다.').toBeLessThanOrEqual(.82);
      layout.secondaryButtons.forEach((button) => {
        expect(button.height, '게임 방법과 설정 버튼은 충분한 터치 높이를 가져야 합니다.').toBeGreaterThanOrEqual(44);
        expect(button.fontSize, '게임 방법과 설정 텍스트는 너무 작으면 안 됩니다.').toBeGreaterThanOrEqual(14);
        expect(button.svg?.width ?? 0, '게임 방법과 설정 아이콘은 충분히 커야 합니다.').toBeGreaterThanOrEqual(24);
      });
    });
  });

  test('방 만들기 팝업은 자동으로 키보드를 열지 않고 좁아진 화면에서도 내용을 스크롤할 수 있다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '키보드QA' });

    await runQaStep(testInfo, '방 만들기 키보드와 축소 뷰포트 대응 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);
      await page.getByRole('button', { name: '방 만들기', exact: true }).click();

      const dialog = page.getByRole('dialog', { name: '방 만들기' });
      const closeButton = dialog.getByRole('button', { name: '닫기', exact: true });
      const titleInput = page.getByTestId('room-title-input');
      const createButton = page.getByTestId('create-room-button');
      await expect(dialog).toBeVisible();
      await expect(closeButton).toBeFocused();
      await expect(titleInput).not.toBeFocused();

      await titleInput.focus();
      await page.setViewportSize({ width: 390, height: 430 });
      await createButton.scrollIntoViewIfNeeded();
      await expect(createButton).toBeVisible();

      const layout = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          viewportHeight: window.innerHeight,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      });

      expect(layout.top, '키보드가 열린 높이에서도 팝업 상단이 화면 밖으로 나가면 안 됩니다.').toBeGreaterThanOrEqual(0);
      expect(layout.bottom, '키보드가 열린 높이에서도 팝업 하단이 화면 밖으로 나가면 안 됩니다.').toBeLessThanOrEqual(layout.viewportHeight + 1);
      expect(layout.height, '팝업 높이는 축소된 뷰포트를 따라야 합니다.').toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.overflowY, '키보드로 공간이 줄면 팝업 내부를 스크롤할 수 있어야 합니다.').toBe('auto');
      expect(layout.scrollHeight, '팝업 내용 높이는 최소한 표시 영역만큼 유지되어야 합니다.').toBeGreaterThanOrEqual(layout.clientHeight);
    });
  });
});
