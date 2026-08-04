import { test } from '@playwright/test';
import './roll-mat-surface-base.case.js';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    let observer;
    let frameId = 0;
    let sampleIndex = 0;

    Object.defineProperty(window, '__YUT_QA_ROLL_MAT_HELD_SURFACE_OBSERVER__', {
      configurable: true,
      get: () => observer,
      set: (nextObserver) => {
        observer = nextObserver;
        if (frameId) cancelAnimationFrame(frameId);
        const sampleAfterPaint = () => {
          if (observer !== nextObserver || !nextObserver) return;
          const stage = document.querySelector('.roll-stage.resolved-from-pending.result-hold-roll');
          if (stage instanceof HTMLElement) {
            sampleIndex += 1;
            stage.style.setProperty('--qa-roll-mat-sample-frame', String(sampleIndex % 2));
          }
          frameId = requestAnimationFrame(sampleAfterPaint);
        };
        frameId = requestAnimationFrame(sampleAfterPaint);
      },
    });
  });
});
