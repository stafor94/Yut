from pathlib import Path
import re
import traceback

path = Path('tests/regression/bug-history-smoke.spec.js')
status_path = Path('.patch-status')
error_path = Path('.patch-error')


def replace_regex(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return updated


try:
    text = path.read_text(encoding='utf-8')

    pending_pattern = r"""      await expect\(page\.locator\('\.roll-stage\.pending-roll \.yut-mark'\).*?      await expect\(page\.locator\('\.roll-stage\.pending-roll\.extra-spin-roll'\).*?\.toHaveCount\(0\);"""
    pending_replacement = """      const pendingScene = page.locator('.roll-stage.pending-roll [data-testid=\"yut-roll-scene\"]');
      await expect(pendingScene, 'pending 단계에서는 새 Three.js 윷 장면 컨테이너가 표시되어야 합니다.').toBeVisible({ timeout: 500 });
      await expect(pendingScene, '클라이언트 윷 던지기는 primary 상승·회전 단계에서 시작해야 합니다.').toHaveAttribute('data-phase', 'primary');
      await expect(pendingScene.locator('.yut-roll-three-canvas'), 'Three.js 렌더러용 canvas는 한 개만 유지되어야 합니다.').toHaveCount(1);
      await expect(pendingScene.locator('.yut-roll-css-fallback .yut-stick'), 'WebGL 초기화 전이나 실패 시 사용할 CSS fallback 윷 4개를 유지해야 합니다.').toHaveCount(4);
      await expect(pendingScene.locator('.yut-mark'), 'pending 단계에서는 결과 면 표시를 숨겨야 합니다.').toHaveCount(0);
      await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        window.__YUT_QA_EXTRA_SPIN_SEEN__ = Boolean(document.querySelector('.roll-stage.pending-roll.extra-spin-roll'));
        const observer = new MutationObserver(() => {
          if (document.querySelector('.roll-stage.pending-roll.extra-spin-roll')) window.__YUT_QA_EXTRA_SPIN_SEEN__ = true;
        });
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__ = observer;
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      const pendingFrameAtStart = await pendingScene.screenshot();
      await page.waitForTimeout(180);
      await expect(pendingScene, 'primary 장면은 즉시 사라지지 않고 실제 상승·회전 프레임을 렌더링해야 합니다.').toHaveAttribute('data-phase', 'primary');
      const pendingFrameInMotion = await pendingScene.screenshot();
      expect(pendingFrameInMotion.equals(pendingFrameAtStart), 'primary 단계의 윷 장면은 시간에 따라 실제 프레임이 변해야 합니다.').toBe(false);"""
    text = replace_regex(text, pending_pattern, pending_replacement, 'pending scene block')

    landing_pattern = r"""      await expect\.poll\(async \(\) => landingStage\.locator\('\.yut-stick'\).*?      \}\)\.toBe\('ready'\);\n\n      const resultHoldStage"""
    landing_replacement = """      const extraSpinSeen = await page.evaluate(() => {
        window.__YUT_QA_EXTRA_SPIN_OBSERVER__?.disconnect();
        return Boolean(window.__YUT_QA_EXTRA_SPIN_SEEN__);
      });
      expect(extraSpinSeen, '클라이언트 선확정 결과는 Firebase 응답을 기다리는 extra-spin 단계로 넘어가면 안 됩니다.').toBe(false);
      const landingScene = landingStage.getByTestId('yut-roll-scene');
      await expect(landingScene, '서버 결과 도착 후 같은 3D 장면이 landing 단계로 이어져야 합니다.').toHaveAttribute('data-phase', 'landing');
      const landingFrameAtStart = await landingScene.screenshot();
      await page.waitForTimeout(180);
      await expect(landingScene, 'landing 단계는 1초 착지 연출 중 유지되어야 합니다.').toHaveAttribute('data-phase', 'landing');
      const landingFrameInMotion = await landingScene.screenshot();
      expect(landingFrameInMotion.equals(landingFrameAtStart), 'landing 단계의 윷 장면은 낙하·정렬 중 실제 프레임이 변해야 합니다.').toBe(false);

      const resultHoldStage"""
    text = replace_regex(text, landing_pattern, landing_replacement, 'landing scene block')

    result_hold_pattern = r"""      await expect\.poll\(async \(\) => resultHoldStage\.locator\('\.yut-stick, \.yut-stick-body'\).*?      \}\)\.toBe\(true\);\n      await expect\(page\.locator\('\.roll-stage\.resolved-from-pending \.roll-stage-timing'\)"""
    result_hold_replacement = """      const resultHoldScene = resultHoldStage.getByTestId('yut-roll-scene');
      await expect(resultHoldScene, '착지 완료 후 동일한 3D 장면이 result-hold 단계로 전환되어야 합니다.').toHaveAttribute('data-phase', 'result-hold');
      await expect.poll(async () => resultHoldScene.getAttribute('data-renderer'), {
        timeout: 5_000,
        message: 'Three.js 또는 CSS fallback 렌더러가 최종 확정되어야 합니다.',
      }).toMatch(/^(three|fallback)$/);
      await page.waitForTimeout(160);
      const settledFrameAtStart = await resultHoldScene.screenshot();
      await page.waitForTimeout(180);
      const settledFrameAfter = await resultHoldScene.screenshot();
      expect(settledFrameAfter.equals(settledFrameAtStart), 'result-hold 단계에서는 최종 자세가 흔들림 없이 고정되어야 합니다.').toBe(true);
      await expect(page.locator('.roll-stage.resolved-from-pending .roll-stage-timing')"""
    text = replace_regex(text, result_hold_pattern, result_hold_replacement, 'result hold scene block')

    finished_animation_pattern = r"""      await expect\.poll\(async \(\) => page\.locator\('\.roll-stage\.resolved-from-pending \.yut-stick, \.roll-stage\.resolved-from-pending \.yut-stick-body'\).*?      \}\)\.toBe\('finished'\);\n"""
    text = replace_regex(text, finished_animation_pattern, '', 'obsolete CSS animation completion block')

    if ".roll-stage.pending-roll .yut-stick" in text[text.index("test('온라인 윷 던지기는"):text.index("test('온라인 윷 던지기는") + 15000]:
        raise RuntimeError('stale pending yut-stick selector remains in sequence replay test')
    if "resultHoldStage.locator('.yut-stick" in text:
        raise RuntimeError('stale result-hold yut-stick selector remains')

    path.write_text(text, encoding='utf-8')
    status_path.write_text('ok\n', encoding='utf-8')
    error_path.unlink(missing_ok=True)
except Exception:
    status_path.write_text('failed\n', encoding='utf-8')
    error_path.write_text(traceback.format_exc(), encoding='utf-8')
