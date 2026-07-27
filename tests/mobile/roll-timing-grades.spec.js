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
  test('타이밍 orb는 CSS animation 없이 단일 position writer를 사용하고 등급과 결과 카드는 기존 계약을 유지한다', async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await primeLobbyStorage(context, { nickname: '타이밍QA' });

    await runQaStep(testInfo, '타이밍 막대 단일 orb position 소유와 통합 결과 카드 시각 계약 확인', async () => {
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
              <span class="roll-timing-orb-track">
                <span class="roll-timing-orb"></span>
              </span>
            </div>
          </div>
          <div class="roll-stage resolved-from-pending result-hold-roll">
            <span class="roll-timing-feedback roll-stage-timing transient perfect">PERFECT</span>
            <div class="roll-result-presentation">
              <span class="roll-label roll-result-card standard">
                <strong class="roll-result-name"><span>걸</span></strong>
                <small class="roll-result-description">3칸 이동</small>
              </span>
            </div>
          </div>
          <span class="roll-timing-feedback transient nice">NICE</span>
          <span class="roll-timing-feedback transient good">GOOD</span>
          <span class="roll-timing-feedback transient bad">BAD</span>
        `;
        document.body.append(host);

        const meter = host.querySelector('.roll-timing-meter');
        const track = host.querySelector('.roll-timing-orb-track');
        const orb = host.querySelector('.roll-timing-orb');
        const legacyZones = Array.from(meter.querySelectorAll(':scope > .roll-timing-good, :scope > .roll-timing-perfect'));
        const meterRect = meter.getBoundingClientRect();
        const readOrbPositionPercent = () => {
          const orbRect = orb.getBoundingClientRect();
          return ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100;
        };
        const sampleOrbPosition = (positionPercent) => {
          orb.style.left = `${positionPercent}%`;
          return readOrbPositionPercent();
        };
        const startPositionPercent = sampleOrbPosition(0);
        const middlePositionPercent = sampleOrbPosition(50);
        const endPositionPercent = sampleOrbPosition(100);
        orb.style.left = '0%';
        const trackStyle = getComputedStyle(track);
        const orbStyle = getComputedStyle(orb);
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
            animationName: style.animationName,
            animationDelay: style.animationDelay,
            animationDuration: style.animationDuration,
            animationFillMode: style.animationFillMode,
            pseudoDisplay: pseudo.display,
          };
        });
        const wrapper = host.querySelector('.roll-result-presentation');
        const card = host.querySelector('.roll-result-card');
        const grade = host.querySelector('.roll-stage-timing');
        const name = host.querySelector('.roll-result-name');
        const description = host.querySelector('.roll-result-description');
        const wrapperRect = wrapper.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const gradeRect = grade.getBoundingClientRect();
        const cardStyle = getComputedStyle(card);
        const result = {
          meterBackground: getComputedStyle(meter).backgroundImage,
          orbBorderColor: orbStyle.borderTopColor,
          orbTrackClass: orb.parentElement?.className ?? '',
          trackPosition: trackStyle.position,
          trackAnimationName: trackStyle.animationName,
          trackAnimationCount: track.getAnimations().length,
          trackTransform: trackStyle.transform,
          trackWillChange: trackStyle.willChange,
          trackBackfaceVisibility: trackStyle.backfaceVisibility,
          orbAnimationName: orbStyle.animationName,
          orbWillChange: orbStyle.willChange,
          orbLeft: orbStyle.left,
          orbMovementPositions: [startPositionPercent, middlePositionPercent, endPositionPercent],
          legacyZoneDisplays: legacyZones.map((zone) => getComputedStyle(zone).display),
          grades,
          wrapperPosition: getComputedStyle(wrapper).position,
          cardDisplay: cardStyle.display,
          cardTranslate: cardStyle.translate,
          cardCenterOffset: Math.abs((cardRect.left + cardRect.width / 2) - (wrapperRect.left + wrapperRect.width / 2)),
          gradeCenterOffset: Math.abs((gradeRect.left + gradeRect.width / 2) - (cardRect.left + cardRect.width / 2)),
          gradeAboveCard: gradeRect.bottom <= cardRect.top + 1,
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
      expect(presentation.orbTrackClass).toBe('roll-timing-orb-track');
      expect(presentation.trackPosition).toBe('absolute');
      expect(presentation.trackAnimationName).toBe('none');
      expect(presentation.trackAnimationCount).toBe(0);
      expect(presentation.trackTransform).toBe('none');
      expect(presentation.trackWillChange).toBe('auto');
      expect(presentation.trackBackfaceVisibility).toBe('hidden');
      expect(presentation.orbAnimationName).toBe('none');
      expect(presentation.orbWillChange).toContain('left');
      expect(presentation.orbLeft).toBe('0px');
      expect(presentation.orbMovementPositions[0]).toBeLessThanOrEqual(1);
      expect(presentation.orbMovementPositions[1]).toBeGreaterThanOrEqual(49);
      expect(presentation.orbMovementPositions[1]).toBeLessThanOrEqual(51);
      expect(presentation.orbMovementPositions[2]).toBeGreaterThanOrEqual(98);
      expect(presentation.legacyZoneDisplays).toEqual(['none', 'none', 'none']);

      for (const grade of presentation.grades) {
        expect(grade.text).toBe(EXPECTED_LABELS[grade.grade]);
        expect(grade.backgroundColor).toBe(EXPECTED_BADGE_COLORS[grade.grade]);
        expect(grade.color).toBe('rgb(255, 255, 255)');
        expect(grade.display).toBe(grade.grade === 'perfect' ? 'flex' : 'inline-flex');
        expect(grade.fontSize).toBeGreaterThanOrEqual(14);
        expect(grade.width).toBeGreaterThanOrEqual(82);
        expect(grade.height).toBeGreaterThanOrEqual(34);
        expect(grade.animationName).toBe('roll-timing-grade-fade');
        expect(grade.animationDelay).toBe('1.5s');
        expect(grade.animationDuration).toBe('0.22s');
        expect(grade.animationFillMode).toBe('forwards');
        expect(grade.pseudoDisplay).toBe('none');
      }

      expect(presentation.wrapperPosition).toBe('absolute');
      expect(presentation.cardDisplay).toBe('grid');
      expect(presentation.cardTranslate).not.toBe('-50%');
      expect(presentation.cardCenterOffset).toBeLessThanOrEqual(1);
      expect(presentation.gradeCenterOffset).toBeLessThanOrEqual(1);
      expect(presentation.gradeAboveCard).toBe(true);
      expect(presentation.cardBackground).not.toBe('none');
      expect(presentation.cardBorderColor).toBe('rgb(123, 75, 42)');
      expect(presentation.cardBorderRadius).toBeGreaterThanOrEqual(12);
      expect(presentation.cardText).toBe('걸 3칸 이동');
      expect(presentation.nameFontSize).toBeGreaterThanOrEqual(26);
      expect(presentation.descriptionFontSize).toBeGreaterThanOrEqual(11);
    });
  });
});
