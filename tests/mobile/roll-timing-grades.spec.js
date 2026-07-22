import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

const EXPECTED_COLORS = {
  perfect: 'rgb(142, 68, 173)',
  nice: 'rgb(2, 132, 199)',
  good: 'rgb(63, 125, 32)',
  bad: 'rgb(17, 24, 39)',
};

test.describe('mobile roll timing grades QA', () => {
  test('타이밍 막대와 결과 문구는 4단계 범위·색상·확대 글꼴을 사용한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '타이밍QA' });

    await runQaStep(testInfo, '타이밍 막대 시각 계약 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const presentation = await page.evaluate(() => {
        const host = document.createElement('div');
        host.style.position = 'absolute';
        host.style.left = '0';
        host.style.top = '0';
        host.innerHTML = `
          <div class="roll-timing-meter"><span class="roll-timing-orb"></span></div>
          <span class="roll-timing-feedback perfect"></span>
          <span class="roll-timing-feedback nice"></span>
          <span class="roll-timing-feedback good"></span>
          <span class="roll-timing-feedback bad"></span>
        `;
        document.body.append(host);

        const meter = host.querySelector('.roll-timing-meter');
        const grades = ['perfect', 'nice', 'good', 'bad'].map((grade) => {
          const element = host.querySelector(`.${grade}`);
          const pseudo = getComputedStyle(element, '::before');
          return {
            grade,
            content: pseudo.content,
            color: pseudo.color,
            fontSize: Number.parseFloat(pseudo.fontSize),
          };
        });
        const result = {
          meterBackground: getComputedStyle(meter).backgroundImage,
          grades,
        };
        host.remove();
        return result;
      });

      expect(presentation.meterBackground).toContain('20%');
      expect(presentation.meterBackground).toContain('40%');
      expect(presentation.meterBackground).toContain('45%');
      expect(presentation.meterBackground).toContain('55%');
      expect(presentation.meterBackground).toContain('60%');
      expect(presentation.meterBackground).toContain('80%');
      expect(presentation.meterBackground).toContain('rgb(17, 24, 39)');
      expect(presentation.meterBackground).toContain('rgb(183, 228, 108)');
      expect(presentation.meterBackground).toContain('rgb(125, 211, 252)');
      expect(presentation.meterBackground).toContain('rgb(142, 68, 173)');

      for (const grade of presentation.grades) {
        expect(grade.content.toLowerCase()).toContain(grade.grade);
        expect(grade.color).toBe(EXPECTED_COLORS[grade.grade]);
        expect(grade.fontSize, `${grade.grade} 결과 문구는 기존보다 약 3단계 크게 보여야 합니다.`).toBeGreaterThanOrEqual(30);
      }
    });
  });
});
