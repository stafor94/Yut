export function createSequenceRollAtPerfect(page) {
  return async () => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        const result = await page.evaluate(() => {
          const meter = document.querySelector('.roll-timing-meter');
          const orb = document.querySelector('.roll-timing-orb');
          const button = document.querySelector('[data-testid="roll-yut-button"]');
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
          window.__YUT_QA_RESULT_HOLD_PRESENTATION__ = null;
          let observer;
          const sample = () => {
            const stage = document.querySelector('.roll-stage.resolved-from-pending.result-hold-roll');
            const now = performance.now();
            if (stage) {
              if (timing.startedAt === 0) timing.startedAt = now;
              const scene = stage.querySelector('[data-testid="yut-roll-scene"]');
              const canvas = scene?.querySelector('.yut-roll-three-canvas');
              const fallback = scene?.querySelector('.yut-roll-css-fallback');
              const timingNode = stage.querySelector('.roll-stage-timing');
              const mat = stage.querySelector('.roll-mat');
              const resultCard = stage.querySelector('[data-testid="roll-result-card"]');
              const resultName = resultCard?.querySelector('.roll-result-name > span:not(.roll-result-symbol)');
              const resultDescription = resultCard?.querySelector('.roll-result-description');
              if (scene && timingNode && mat && resultCard && resultName && resultDescription) {
                const toBox = (node) => {
                  const rect = node.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0
                    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                    : null;
                };
                const matStyle = getComputedStyle(mat);
                const canvasStyle = canvas ? getComputedStyle(canvas) : null;
                const fallbackStyle = fallback ? getComputedStyle(fallback) : null;
                const snapshot = {
                  phase: scene.getAttribute('data-phase') ?? '',
                  renderer: scene.getAttribute('data-renderer') ?? '',
                  canvasOpacity: canvasStyle ? Number.parseFloat(canvasStyle.opacity) : -1,
                  fallbackVisibility: fallbackStyle?.visibility ?? 'missing',
                  sceneBox: toBox(scene),
                  timingCount: stage.querySelectorAll('.roll-stage-timing').length,
                  timingText: timingNode.textContent?.trim() ?? '',
                  timingBox: toBox(timingNode),
                  matBox: toBox(mat),
                  resultCardCount: stage.querySelectorAll('[data-testid="roll-result-card"]').length,
                  resultCardBox: toBox(resultCard),
                  resultName: resultName.textContent?.trim() ?? '',
                  resultDescription: resultDescription.textContent?.trim() ?? '',
                  matClassName: mat.getAttribute('class') ?? '',
                  matAnimation: `${matStyle.animationName}/${matStyle.opacity}/${matStyle.transform}`,
                  gameText: document.querySelector('[data-testid="game-screen"]')?.textContent ?? '',
                  turnStackText: document.querySelector('[data-testid="turn-indicator"]')?.textContent ?? '',
                };
                const classes = snapshot.matClassName.split(/\s+/u);
                if (snapshot.phase === 'result-hold'
                  && /^(three|fallback)$/u.test(snapshot.renderer)
                  && /^(BAD|GOOD|NICE|PERFECT)$/u.test(snapshot.timingText)
                  && snapshot.resultName
                  && snapshot.resultDescription
                  && (!(classes.includes('bonus-roll') || classes.includes('fall-roll'))
                    || snapshot.matAnimation === 'none/1/matrix(1, 0, 0, 1, 0, 0)')) {
                  window.__YUT_QA_RESULT_HOLD_PRESENTATION__ = snapshot;
                }
              }
            } else if (timing.startedAt > 0 && timing.endedAt === 0) {
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
  };
}
