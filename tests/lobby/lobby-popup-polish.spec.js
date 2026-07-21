import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('lobby popup visual polish QA', () => {
  test('새로고침은 완성된 원형 화살표로 보이고 게임 방법은 한눈에 읽히는 계층을 유지한다', async ({ page, context }) => {
    await primeLobbyStorage(context, { nickname: '팝업품질QA' });
    await expectAppShell(page);
    await waitForBlockingOverlayToDisappear(page);

    await page.getByRole('button', { name: '방 참가', exact: true }).click();
    const joinDialog = page.getByRole('dialog', { name: '방 참가' });
    const refreshIcon = joinDialog.locator('.lobby-room-refresh-icon');
    await expect(refreshIcon).toBeVisible();

    const refreshDrawing = await refreshIcon.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const svg = element.querySelector('svg');
      const path = svg?.querySelector('path');
      const svgRect = svg?.getBoundingClientRect();
      const pathStyle = path ? getComputedStyle(path) : null;
      return {
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(style.fontSize),
        svgWidth: svgRect?.width ?? 0,
        svgHeight: svgRect?.height ?? 0,
        strokeWidth: pathStyle ? Number.parseFloat(pathStyle.strokeWidth) : 0,
        pathData: path?.getAttribute('d') ?? '',
      };
    });

    expect(refreshDrawing.width, '새로고침 아이콘은 버튼 안에서 식별 가능한 크기여야 합니다.').toBeGreaterThanOrEqual(16);
    expect(refreshDrawing.height).toBeGreaterThanOrEqual(16);
    expect(refreshDrawing.fontSize, '유니코드 글자를 그대로 노출하지 않고 도형으로 그려야 합니다.').toBe(0);
    expect(refreshDrawing.svgWidth, '새로고침 SVG는 버튼 안에서 식별 가능한 크기여야 합니다.').toBeGreaterThanOrEqual(18);
    expect(refreshDrawing.svgHeight).toBeGreaterThanOrEqual(18);
    expect(refreshDrawing.strokeWidth, 'SVG 새로고침 선이 충분히 선명해야 합니다.').toBeGreaterThanOrEqual(2);
    expect(refreshDrawing.pathData, '유니코드가 아니라 표준 새로고침 SVG path가 있어야 합니다.').toContain('M21 12');

    await joinDialog.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '게임 방법', exact: true }).click();

    const guideDialog = page.getByRole('dialog', { name: '게임 방법' });
    await expect(guideDialog).toBeVisible();
    await expect(guideDialog.locator('.howto-list article')).toHaveCount(4);
    await expect(guideDialog.locator('.howto-result-strip span')).toHaveCount(5);
    await expect(guideDialog).toContainText('윷·모가 나오거나 상대 말을 잡으면 한 번 더 던질 수 있습니다.');
    await expect(guideDialog).toContainText('승리 조건');

    const guideLayout = await guideDialog.evaluate((dialog) => {
      const cards = Array.from(dialog.querySelectorAll('.howto-list article'));
      const button = dialog.querySelector('.howto-confirm-button');
      if (cards.length !== 4 || !(button instanceof HTMLElement)) return null;
      const dialogRect = dialog.getBoundingClientRect();
      const cardRects = cards.map((card) => card.getBoundingClientRect());
      const buttonRect = button.getBoundingClientRect();
      const dialogStyle = getComputedStyle(dialog);
      const buttonStyle = getComputedStyle(button);
      return {
        viewportHeight: window.innerHeight,
        dialogTop: dialogRect.top,
        dialogBottom: dialogRect.bottom,
        overflowY: dialogStyle.overflowY,
        firstRowSpread: Math.abs(cardRects[0].top - cardRects[1].top),
        secondRowStartsAfterFirst: cardRects[2].top > cardRects[0].top,
        buttonTop: buttonRect.top,
        buttonBottom: buttonRect.bottom,
        buttonPosition: buttonStyle.position,
      };
    });

    expect(guideLayout, '게임 방법 팝업의 카드와 하단 동작을 읽을 수 있어야 합니다.').not.toBeNull();
    expect(guideLayout.dialogTop, '팝업 상단이 화면 밖으로 잘리면 안 됩니다.').toBeGreaterThanOrEqual(-1);
    expect(guideLayout.dialogBottom, '팝업 하단이 화면 밖으로 잘리면 안 됩니다.').toBeLessThanOrEqual(guideLayout.viewportHeight + 1);
    expect(guideLayout.overflowY, '내용이 길어질 때 팝업 내부에서 스크롤할 수 있어야 합니다.').toBe('auto');
    expect(guideLayout.firstRowSpread, '설명 카드는 두 장씩 정렬되어 한눈에 비교할 수 있어야 합니다.').toBeLessThanOrEqual(1);
    expect(guideLayout.secondRowStartsAfterFirst).toBe(true);
    expect(guideLayout.buttonPosition, '확인 버튼은 스크롤 중에도 접근 가능해야 합니다.').toBe('sticky');
    expect(guideLayout.buttonTop).toBeGreaterThanOrEqual(guideLayout.dialogTop);
    expect(guideLayout.buttonBottom).toBeLessThanOrEqual(guideLayout.viewportHeight + 1);
  });
});
