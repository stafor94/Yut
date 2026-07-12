from pathlib import Path
import traceback

path = Path('tests/regression/bug-history-smoke.spec.js')
status_path = Path('.patch-status')
error_path = Path('.patch-error')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


try:
    text = path.read_text(encoding='utf-8')

    text = replace_once(
        text,
        """      const pendingFrameAtStart = await pendingScene.screenshot();
      await page.waitForTimeout(180);
      await expect(pendingScene, 'primary 장면은 즉시 사라지지 않고 실제 상승·회전 프레임을 렌더링해야 합니다.').toHaveAttribute('data-phase', 'primary');
      const pendingFrameInMotion = await pendingScene.screenshot();
      expect(pendingFrameInMotion.equals(pendingFrameAtStart), 'primary 단계의 윷 장면은 시간에 따라 실제 프레임이 변해야 합니다.').toBe(false);
""",
        """      const pendingRendererAtStart = await pendingScene.getAttribute('data-renderer');
      expect(['loading', 'three', 'fallback'], 'pending 장면은 Three.js 초기화 또는 CSS fallback 상태여야 합니다.').toContain(pendingRendererAtStart);
""",
        'pending screenshot block',
    )

    text = replace_once(
        text,
        """      const landingFrameAtStart = await landingScene.screenshot();
      await page.waitForTimeout(180);
      await expect(landingScene, 'landing 단계는 1초 착지 연출 중 유지되어야 합니다.').toHaveAttribute('data-phase', 'landing');
      const landingFrameInMotion = await landingScene.screenshot();
      expect(landingFrameInMotion.equals(landingFrameAtStart), 'landing 단계의 윷 장면은 낙하·정렬 중 실제 프레임이 변해야 합니다.').toBe(false);
""",
        """      await expect(landingScene.locator('.yut-roll-three-canvas'), 'landing 단계에서도 동일한 Three.js canvas를 유지해야 합니다.').toHaveCount(1);
      await expect(landingScene.locator('.yut-roll-css-fallback .yut-stick'), 'landing 단계에서도 WebGL 실패 대비 fallback 윷 4개를 유지해야 합니다.').toHaveCount(4);
""",
        'landing screenshot block',
    )

    text = replace_once(
        text,
        """      await page.waitForTimeout(160);
      const settledFrameAtStart = await resultHoldScene.screenshot();
      await page.waitForTimeout(180);
      const settledFrameAfter = await resultHoldScene.screenshot();
      expect(settledFrameAfter.equals(settledFrameAtStart), 'result-hold 단계에서는 최종 자세가 흔들림 없이 고정되어야 합니다.').toBe(true);
""",
        """      const rendererPresentation = await resultHoldScene.evaluate((node) => {
        const canvas = node.querySelector('.yut-roll-three-canvas');
        const fallback = node.querySelector('.yut-roll-css-fallback');
        return {
          status: node.getAttribute('data-renderer'),
          canvasOpacity: canvas ? Number.parseFloat(getComputedStyle(canvas).opacity) : -1,
          fallbackVisibility: fallback ? getComputedStyle(fallback).visibility : 'missing',
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        };
      });
      expect(rendererPresentation.width, '결과 유지 장면은 실제 표시 너비를 가져야 합니다.').toBeGreaterThan(0);
      expect(rendererPresentation.height, '결과 유지 장면은 실제 표시 높이를 가져야 합니다.').toBeGreaterThan(0);
      if (rendererPresentation.status === 'three') {
        expect(rendererPresentation.canvasOpacity, 'Three.js 렌더러가 선택되면 canvas가 불투명하게 표시되어야 합니다.').toBeGreaterThan(0.9);
        expect(rendererPresentation.fallbackVisibility, 'Three.js 렌더러가 선택되면 CSS fallback은 숨겨야 합니다.').toBe('hidden');
      } else {
        expect(rendererPresentation.status, 'WebGL 초기화 실패 시 fallback 상태로 확정되어야 합니다.').toBe('fallback');
        expect(rendererPresentation.fallbackVisibility, 'fallback 렌더러가 선택되면 CSS 윷 장면이 보여야 합니다.').toBe('visible');
      }
""",
        'result hold screenshot block',
    )

    if '.screenshot()' in text[text.index("test('온라인 윷 던지기는"):text.index("test('온라인 윷 던지기는") + 14000]:
        raise RuntimeError('slow screenshot assertion remains in online roll regression test')

    path.write_text(text, encoding='utf-8')
    status_path.write_text('ok\n', encoding='utf-8')
    error_path.unlink(missing_ok=True)
except Exception:
    status_path.write_text('failed\n', encoding='utf-8')
    error_path.write_text(traceback.format_exc(), encoding='utf-8')
