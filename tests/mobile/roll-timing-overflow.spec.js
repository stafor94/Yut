import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const gameCss = readFileSync('src/styles/game.css', 'utf8');
const timingCss = readFileSync('src/styles/roll-timing-ios-smoothness.css', 'utf8');
const POSITION_TOLERANCE_PERCENT = 0.25;

test.describe('mobile roll timing horizontal overflow regression', () => {
  test('오브는 고정 트랙 안에서 0·50·100%를 표시하며 이동 중 문서 가로 폭과 scrollLeft를 바꾸지 않는다', async ({ page }) => {
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; min-width: 0; }
        ${gameCss}
        ${timingCss}
      </style>
      <main class="game-shell" style="width: min(100%, 360px); padding: 24px;">
        <div class="roll-timing-meter roll-timing-live-meter" aria-label="윷 던지기 정확도 막대">
          <span class="roll-timing-good left" aria-hidden="true"></span>
          <span class="roll-timing-perfect" aria-hidden="true"></span>
          <span class="roll-timing-good right" aria-hidden="true"></span>
          <span class="roll-timing-orb-track" aria-hidden="true" style="transform: none;">
            <span class="roll-timing-orb" style="left: 0%;"></span>
          </span>
        </div>
      </main>
    `);

    const result = await page.evaluate(async () => {
      const meter = document.querySelector('.roll-timing-live-meter');
      const track = meter?.querySelector('.roll-timing-orb-track');
      const orb = meter?.querySelector('.roll-timing-orb');
      if (!(meter instanceof HTMLElement) || !(track instanceof HTMLElement) || !(orb instanceof HTMLElement)) {
        throw new Error('타이밍 막대 또는 오브를 찾지 못했습니다.');
      }

      const readHorizontalState = () => ({
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollLeft: document.documentElement.scrollLeft,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollLeft: document.body.scrollLeft,
        windowScrollX: window.scrollX,
      });
      const readPosition = (positionPercent) => {
        orb.style.left = `${positionPercent}%`;
        const meterRect = meter.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const orbRect = orb.getBoundingClientRect();
        const meterContentLeft = meterRect.left + meter.clientLeft;
        const visibleLeft = Math.max(orbRect.left, trackRect.left);
        const visibleRight = Math.min(orbRect.right, trackRect.right);
        return {
          requestedPositionPercent: positionPercent,
          visiblePositionPercent: ((orbRect.left + orbRect.width / 2 - meterContentLeft) / meter.clientWidth) * 100,
          visibleOrbWidth: Math.max(0, visibleRight - visibleLeft),
          orbWidth: orbRect.width,
          meterWidth: meter.clientWidth,
          trackWidth: trackRect.width,
          trackLeftDelta: trackRect.left - meterContentLeft,
          inlineTrackTransform: track.style.transform,
          computedTrackTransform: getComputedStyle(track).transform,
          horizontal: readHorizontalState(),
        };
      };

      const baseline = readHorizontalState();
      const boundarySamples = [0, 50, 100].map(readPosition);
      const movementSamples = [];
      for (let index = 0; index <= 24; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const positionPercent = index <= 12 ? index * (100 / 12) : (24 - index) * (100 / 12);
        orb.style.left = `${positionPercent}%`;
        movementSamples.push({
          positionPercent,
          trackTransform: track.style.transform,
          horizontal: readHorizontalState(),
        });
      }

      return {
        baseline,
        boundarySamples,
        movementSamples,
        htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
        bodyOverflowX: getComputedStyle(document.body).overflowX,
      };
    });

    expect(result.htmlOverflowX).not.toBe('hidden');
    expect(result.bodyOverflowX).not.toBe('hidden');
    expect(result.boundarySamples).toHaveLength(3);
    for (const sample of result.boundarySamples) {
      expect(Math.abs(sample.visiblePositionPercent - sample.requestedPositionPercent)).toBeLessThanOrEqual(POSITION_TOLERANCE_PERCENT);
      expect(sample.visibleOrbWidth).toBeGreaterThan(0);
      expect(sample.visibleOrbWidth).toBeLessThanOrEqual(sample.orbWidth);
      expect(Math.abs(sample.trackWidth - sample.meterWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.trackLeftDelta)).toBeLessThanOrEqual(1);
      expect(sample.inlineTrackTransform).toBe('none');
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(sample.computedTrackTransform);
      expect(sample.horizontal.documentScrollWidth).toBe(result.baseline.documentScrollWidth);
      expect(sample.horizontal.bodyScrollWidth).toBe(result.baseline.bodyScrollWidth);
      expect(sample.horizontal.documentScrollLeft).toBe(result.baseline.documentScrollLeft);
      expect(sample.horizontal.bodyScrollLeft).toBe(result.baseline.bodyScrollLeft);
      expect(sample.horizontal.windowScrollX).toBe(result.baseline.windowScrollX);
    }

    expect(result.movementSamples.map((sample) => Math.round(sample.positionPercent))).toContain(100);
    for (const sample of result.movementSamples) {
      expect(sample.trackTransform).toBe('none');
      expect(sample.horizontal.documentScrollWidth).toBe(result.baseline.documentScrollWidth);
      expect(sample.horizontal.bodyScrollWidth).toBe(result.baseline.bodyScrollWidth);
      expect(sample.horizontal.documentScrollLeft).toBe(result.baseline.documentScrollLeft);
      expect(sample.horizontal.bodyScrollLeft).toBe(result.baseline.bodyScrollLeft);
      expect(sample.horizontal.windowScrollX).toBe(result.baseline.windowScrollX);
    }
  });
});
