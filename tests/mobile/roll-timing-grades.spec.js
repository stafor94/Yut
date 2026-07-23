import { test, expect } from '@playwright/test';
import { expectAppShell, primeLobbyStorage, runQaStep, waitForBlockingOverlayToDisappear } from '../helpers/ui.js';

const EXPECTED_BADGE_COLORS = {
  perfect: 'rgb(109, 74, 255)',
  nice: 'rgb(36, 158, 209)',
  good: 'rgb(85, 168, 79)',
  bad: 'rgb(52, 55, 61)',
};

const EXPECTED_LABELS = {
  perfect: 'PERFECT',
  nice: 'NICE',
  good: 'GOOD',
  bad: 'BAD',
};

test.describe('mobile roll timing grades QA', () => {
  test('타이밍 등급은 고대비 배지, 윷 결과는 이동 설명이 있는 한지 카드로 표시한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '타이밍QA' });

    await runQaStep(testInfo, '타이밍 막대와 통합 결과 카드 시각 계약 확인', async () => {
      await expectAppShell(page);
      await waitForBlockingOverlayToDisappear(page);

      const presentation = await page.evaluate(() => {
        const host = document.createElement('div');
        host.className = 'game-shell';
        host.style.position = 'absolute';
        host.style.left = '0';
        host.style.top = '0';
        host.innerHTML = `
          <div class="play-controls">
            <div class="roll-timing-meter">
              <span class="roll-timing-good left"></span>
              <span class="roll-timing-perfect"></span>
              <span class="roll-timing-good right"></span>
              <span class="roll-timing-orb"></span>
            </div>
          </div>
          <div class="roll-stage resolved-from-pending result-hold-roll">
            <div class="roll-result-presentation">
              <span class="roll-timing-feedback roll-stage-timing perfect">PERFECT</span>
              <span class="roll-label roll-result-card standard">
                <strong class="roll-result-name"><span>걸</span></strong>
                <small class="roll-result-description">3칸 이동</small>
              </span>
            </div>
          </div>
          <span class="roll-timing-feedback nice">NICE</span>
          <span class="roll-timing-feedback good">GOOD</span>
          <span class="roll-timing-feedback bad">BAD</span>
        `;
        document.body.append(host);

        const meter = host.querySelector('.roll-timing-meter');
        const orb = host.querySelector('.roll-timing-orb');
        const legacyZones = Array.from(meter.querySelectorAll(':scope > span:not(.roll-timing-orb)'));
        const grades = ['perfect', 'nice', 'good', 'bad'].map((grade) => {
          const element = host.querySelector(`.roll-timing-feedback.${grade}`);
          const style = getComputedStyle(element);
          const pseudo = getComputedStyle(element, '::before');
          const rect = element.getBoundingClientRect();
          return {
            grade,
            text: element.textContent,
            backgroundColor: style.backgroundColor,
            color: style.color,
            display: style.display,
            fontSize: Number.parseFloat(style.fontSize),
            width: rect.width,
            height: rect.height,
            pseudoDisplay: pseudo.display,
          };
        });
        const wrapper = host.querySelector('.roll-result-presentation');
        const card = host.querySelector('.roll-result-card');
        const name = host.querySelector('.roll-result-name');
        const description = host.querySelector('.roll-result-description');
        const wrapperRect = wrapper.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        const result = {
          meterBackground: getComputedStyle(meter).backgroundImage,
          orbBorderColor: getComputedStyle(orb).borderTopColor,
          legacyZoneDisplays: legacyZones.map((zone) => getComputedStyle(zone).display),
          grades,
          wrapperPosition: getComputedStyle(wrapper).position,
          cardDisplay: cardStyle.display,
          cardTranslate: cardStyle.translate,
          cardCenterOffset: Math.abs((cardRect.left + cardRect.width / 2) - (wrapperRect.left + wrapperRect.width / 2)),
          cardBackground: cardStyle.backgroundImage,
          cardBorderColor: cardStyle.borderTopColor,
          cardBorderRadius: Number.parseFloat(cardStyle.borderTopLeftRadius),
          cardText: card.textContent.replace(/\s+/g, ' ').trim(),
          nameFontSize: Number.parseFloat(getComputedStyle(name).fontSize),
          descriptionFontSize: Number.parseFloat(getComputedStyle(description).fontSize),
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
      expect(presentation.meterBackground).toContain('rgb(48, 40, 36)');
      expect(presentation.meterBackground).toContain('rgb(169, 201, 107)');
      expect(presentation.meterBackground).toContain('rgb(101, 185, 211)');
      expect(presentation.meterBackground).toContain('rgb(149, 104, 199)');
      expect(presentation.orbBorderColor).toBe('rgb(255, 255, 255)');
      expect(presentation.legacyZoneDisplays).toEqual(['none', 'none', 'none']);

      for (const grade of presentation.grades) {
        expect(grade.text).toBe(EXPECTED_LABELS[grade.grade]);
        expect(grade.backgroundColor).toBe(EXPECTED_BADGE_COLORS[grade.grade]);
        expect(grade.color).toBe('rgb(255, 255, 255)');
        expect(grade.display).toBe(grade.grade === 'perfect' ? 'flex' : 'inline-flex');
        expect(grade.fontSize).toBeGreaterThanOrEqual(14);
        expect(grade.width).toBeGreaterThanOrEqual(82);
        expect(grade.height).toBeGreaterThanOrEqual(34);
        expect(grade.pseudoDisplay).toBe('none');
      }

      expect(presentation.wrapperPosition).toBe('absolute');
      expect(presentation.cardDisplay).toBe('grid');
      expect(presentation.cardTranslate).not.toBe('-50%');
      expect(presentation.cardCenterOffset).toBeLessThanOrEqual(1);
      expect(presentation.cardBackground).not.toBe('none');
      expect(presentation.cardBorderColor).toBe('rgb(123, 75, 42)');
      expect(presentation.cardBorderRadius).toBeGreaterThanOrEqual(12);
      expect(presentation.cardText).toBe('걸 3칸 이동');
      expect(presentation.nameFontSize).toBeGreaterThanOrEqual(26);
      expect(presentation.descriptionFontSize).toBeGreaterThanOrEqual(11);
    });
  });
});
