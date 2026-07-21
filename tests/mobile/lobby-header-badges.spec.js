import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

test.describe('mobile lobby header badge QA', () => {
  test('상단 배지의 장식 문자를 제거하고 텍스트 크기와 정렬을 통일한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '배지정렬QA' });

    await runQaStep(testInfo, '로비 상단 배지 문자·폰트·정렬 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const badgeLayout = await page.evaluate(() => {
        const nickname = document.querySelector('.screen-lobby > .hero.panel .nickname-chip');
        const sound = document.querySelector('.screen-lobby > .hero.panel .sound-toggle');
        const status = document.querySelector('.screen-lobby > .hero.panel .status-card');
        const nicknameLabel = nickname?.querySelector('span:last-child');
        const soundLabel = sound?.querySelector('.sound-label');
        const statusLabel = status?.querySelector('.status-text');
        const buttons = [nickname, sound, status];
        const labels = [nicknameLabel, soundLabel, statusLabel];

        if (buttons.some((button) => !(button instanceof HTMLElement)) || labels.some((label) => !(label instanceof HTMLElement))) return null;

        return {
          chevrons: document.querySelectorAll('.screen-lobby .lobby-chip-chevron, .screen-lobby .lobby-status-chevron').length,
          fontSizes: labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize)),
          justifyContents: buttons.map((button) => getComputedStyle(button).justifyContent),
          textAligns: buttons.map((button) => getComputedStyle(button).textAlign),
        };
      });

      expect(badgeLayout, '상단 세 배지와 라벨을 읽을 수 있어야 합니다.').not.toBeNull();
      expect(badgeLayout.chevrons, '효과음과 온라인 배지 우측 장식 문자는 제거되어야 합니다.').toBe(0);
      expect(new Set(badgeLayout.fontSizes).size, '상단 세 배지의 텍스트 크기는 같아야 합니다.').toBe(1);
      badgeLayout.justifyContents.forEach((value) => expect(value, '상단 배지 내용은 가로 중앙 정렬되어야 합니다.').toBe('center'));
      badgeLayout.textAligns.forEach((value) => expect(value, '상단 배지 텍스트는 중앙 정렬되어야 합니다.').toBe('center'));
    });
  });
});
