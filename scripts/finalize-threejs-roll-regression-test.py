from pathlib import Path
import re
import traceback

path = Path('tests/regression/bug-history-smoke.spec.js')
status_path = Path('.patch-status')
error_path = Path('.patch-error')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return updated


try:
    text = path.read_text(encoding='utf-8')

    text = sub_once(
        text,
        r"    const clickSequenceRollAtPerfect = \(\) => page\.evaluate\(\(\) => new Promise\(\(resolve, reject\) => \{.*?\n    \}\)\);\n\n    await runQaStep\(testInfo, 'AI 게임 시작'",
        """    const clickSequenceRollAtPerfect = async () => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        try {
          const result = await page.evaluate(() => {
            const meter = document.querySelector('.roll-timing-meter');
            const orb = document.querySelector('.roll-timing-orb');
            const button = document.querySelector('[data-testid=\"roll-yut-button\"]');
            if (!meter || !orb || !(button instanceof HTMLButtonElement) || button.disabled) return { clicked: false, positionPercent: -1 };
            const meterRect = meter.getBoundingClientRect();
            const orbRect = orb.getBoundingClientRect();
            const positionPercent = meterRect.width > 0
              ? ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100
              : -1;
            if (positionPercent < 47 || positionPercent > 53) return { clicked: false, positionPercent };

            window.__YUT_QA_RESULT_HOLD_OBSERVER__?.disconnect();
            const timing = { startedAt: 0, endedAt: 0 };
            window.__YUT_QA_RESULT_HOLD_TIMING__ = timing;
            let observer;
            const sample = () => {
              const visible = Boolean(document.querySelector('.roll-stage.resolved-from-pending.result-hold-roll'));
              const now = performance.now();
              if (visible && timing.startedAt === 0) timing.startedAt = now;
              if (!visible && timing.startedAt > 0 && timing.endedAt === 0) {
                timing.endedAt = now;
                observer?.disconnect();
              }
            };
            observer = new MutationObserver(sample);
            window.__YUT_QA_RESULT_HOLD_OBSERVER__ = observer;
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
            sample();
            button.click();
            return { clicked: true, positionPercent };
          });
          if (result.clicked) return result.positionPercent;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/Execution context was destroyed|Cannot find context|Target page, context or browser has been closed/u.test(message)) throw error;
          await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        }
        await page.waitForTimeout(16);
      }
      throw new Error('8초 동안 Perfect 구간에서 윷 던지기 버튼을 클릭하지 못했습니다.');
    };

    await runQaStep(testInfo, 'AI 게임 시작'""",
        'atomic resilient roll click helper',
    )

    text = sub_once(
        text,
        r"\n      await page\.evaluate\(\(\) => \{\n        window\.__YUT_QA_RESULT_HOLD_OBSERVER__\?\.disconnect\(\);.*?\n      \}\);\n      await clickSequenceRollAtPerfect\(\);",
        "\n      await clickSequenceRollAtPerfect();",
        'remove separate result-hold observer setup',
    )

    text = replace_once(
        text,
        """      window.__YUT_QA_AI_MOVE_OBSERVATIONS__ = {};
      window.__YUT_QA_LOCAL_MOVE_SEEN__ = false;
      window.__YUT_QA_AI_MOVE_OBSERVER__ = window.setInterval(() => {""",
        """      window.__YUT_QA_AI_MOVE_OBSERVATIONS__ = {};
      window.__YUT_QA_AI_MOVE_OBSERVER__ = window.setInterval(() => {""",
        'remove interval-owned local flag initialization',
    )

    text = replace_once(
        text,
        """          if (localSeatId && debugPiece.ownerId === localSeatId) {
            window.__YUT_QA_LOCAL_MOVE_SEEN__ = true;
            continue;
          }
""",
        """          if (localSeatId && debugPiece.ownerId === localSeatId) continue;
""",
        'restore AI observer local skip',
    )

    text = sub_once(
        text,
        r"    const clickMoveWhenReadyOrWaitForRetry = \(\) => page\.evaluate\(\(\) => new Promise\(\(resolve, reject\) => \{.*?\n    \}\)\);",
        """    const clickMoveWhenReadyOrWaitForRetry = () => page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const sample = () => {
        const moveButton = document.querySelector('[data-testid=\"move-piece-button\"]');
        if (moveButton instanceof HTMLButtonElement && !moveButton.disabled) {
          window.__YUT_QA_LOCAL_MOVE_OBSERVER__?.disconnect();
          if (window.__YUT_QA_LOCAL_MOVE_OBSERVER_TIMEOUT__) window.clearTimeout(window.__YUT_QA_LOCAL_MOVE_OBSERVER_TIMEOUT__);
          window.__YUT_QA_LOCAL_MOVE_SEEN__ = false;
          const selectedTestIds = new Set(Array.from(document.querySelectorAll('[data-testid^=\"piece-\"].selected'))
            .map((node) => node.getAttribute('data-testid') ?? '')
            .filter(Boolean));
          const scan = () => {
            const movingSelectedPiece = Array.from(document.querySelectorAll('[data-testid^=\"piece-\"].moving'))
              .some((node) => selectedTestIds.has(node.getAttribute('data-testid') ?? ''));
            if (!movingSelectedPiece) return;
            window.__YUT_QA_LOCAL_MOVE_SEEN__ = true;
            window.__YUT_QA_LOCAL_MOVE_OBSERVER__?.disconnect();
          };
          const observer = new MutationObserver(scan);
          window.__YUT_QA_LOCAL_MOVE_OBSERVER__ = observer;
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
          window.__YUT_QA_LOCAL_MOVE_OBSERVER_TIMEOUT__ = window.setTimeout(() => observer.disconnect(), 3_000);
          moveButton.click();
          scan();
          queueMicrotask(scan);
          requestAnimationFrame(scan);
          resolve('move-clicked');
          return;
        }
        const rollButton = document.querySelector('[data-testid=\"roll-yut-button\"]');
        if (rollButton instanceof HTMLButtonElement && !rollButton.disabled) {
          resolve('retry');
          return;
        }
        if (performance.now() - startedAt > 45_000) {
          reject(new Error('이동 버튼 활성화 또는 이동 불가 결과 후 다음 윷 던지기 차례 복귀를 확인하지 못했습니다.'));
          return;
        }
        requestAnimationFrame(sample);
      };
      sample();
    }));""",
        'selected local piece mutation observer',
    )

    if text.count('__YUT_QA_RESULT_HOLD_TIMING__ = timing') != 1:
        raise RuntimeError('result-hold timing observer must be initialized atomically exactly once')
    if text.count('__YUT_QA_LOCAL_MOVE_SEEN__ = false') != 1:
        raise RuntimeError('local movement flag must be reset exactly at move click')
    if 'const clickSequenceRollAtPerfect = () => page.evaluate' in text:
        raise RuntimeError('long-running roll page.evaluate helper remains')

    path.write_text(text, encoding='utf-8')
    status_path.write_text('ok\n', encoding='utf-8')
    error_path.unlink(missing_ok=True)
except Exception:
    status_path.write_text('failed\n', encoding='utf-8')
    error_path.write_text(traceback.format_exc(), encoding='utf-8')
