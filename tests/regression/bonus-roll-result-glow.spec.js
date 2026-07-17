import { test, expect } from '@playwright/test';
import { expectAppShell } from '../helpers/ui.js';

const BONUS_RESULT_GLOW_DURATION = '1.4s';

const readGlowState = (surface) => surface.evaluate((node) => {
  const pseudoStyle = getComputedStyle(node, '::after');
  const matStyle = getComputedStyle(node.closest('.roll-mat'));
  return {
    animationName: pseudoStyle.animationName,
    animationDuration: pseudoStyle.animationDuration,
    animationPlayState: pseudoStyle.animationPlayState,
    opacity: Number.parseFloat(pseudoStyle.opacity),
    matAnimationName: matStyle.animationName,
  };
});

test.describe('bonus roll result glow regression', () => {
  test('내 던지기와 상대 던지기 모두 윷·모 텍스트 공개 순간부터 같은 황금 애니메이션을 실행한다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expectAppShell(page);

    await page.evaluate(() => {
      document.getElementById('qa-bonus-result-glow-root')?.remove();
      const root = document.createElement('div');
      root.id = 'qa-bonus-result-glow-root';
      root.innerHTML = `
        <div class="roll-stage resolved-from-pending resolved-roll result-hold-roll" data-roll-path="local">
          <div class="roll-mat bonus-roll">
            <span class="roll-mat-surface"></span>
            <span class="roll-label" hidden>윷</span>
          </div>
        </div>
        <div class="roll-stage resolved-roll" data-roll-path="remote">
          <div class="roll-mat bonus-roll">
            <span class="roll-mat-surface"></span>
            <span class="roll-label" hidden>모</span>
          </div>
        </div>
      `;
      document.body.append(root);
    });

    const localStage = page.locator('[data-roll-path="local"]');
    const remoteStage = page.locator('[data-roll-path="remote"]');
    const localSurface = localStage.locator('.roll-mat-surface');
    const remoteSurface = remoteStage.locator('.roll-mat-surface');

    for (const surface of [localSurface, remoteSurface]) {
      const beforeReveal = await readGlowState(surface);
      expect(beforeReveal.matAnimationName, '결과 공개 전에 기존 bonus-mat-pop이 먼저 실행되면 안 됩니다.').toBe('none');
      expect(beforeReveal.animationName, '결과 텍스트가 숨겨진 동안 황금 결과 애니메이션을 시작하면 안 됩니다.').toBe('none');
      expect(beforeReveal.opacity).toBe(0);
    }

    await page.evaluate(() => {
      document.querySelectorAll('#qa-bonus-result-glow-root .roll-label').forEach((label) => {
        label.hidden = false;
      });
    });

    for (const [pathName, surface] of [['내 던지기', localSurface], ['상대 던지기', remoteSurface]]) {
      await expect.poll(async () => readGlowState(surface), {
        timeout: 500,
        message: `${pathName}에서 윷·모 텍스트 공개 직후 황금 애니메이션이 시작되어야 합니다.`,
      }).toMatchObject({
        animationName: 'bonus-result-gold-glow',
        animationDuration: BONUS_RESULT_GLOW_DURATION,
        animationPlayState: 'running',
        matAnimationName: 'none',
      });

      await expect.poll(async () => (await readGlowState(surface)).opacity, {
        timeout: 500,
        message: `${pathName}의 황금 광원이 결과 공개 직후 실제로 보여야 합니다.`,
      }).toBeGreaterThan(0);
    }

    await page.locator('#qa-bonus-result-glow-root').evaluate((node) => node.remove());
  });
});
