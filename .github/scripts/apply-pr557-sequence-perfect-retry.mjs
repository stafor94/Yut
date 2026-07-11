import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/regression/bug-history-smoke.spec.js';
let source = readFileSync(path, 'utf8');

const initAnchor = `    await context.addInitScript(() => {\n      window.__YUT_QA_DELAY_ROLL_YUT_ACTION_MS__ = 3500;\n    });\n\n`;
const helper = `    const clickSequenceRollAtPerfect = () => page.evaluate(() => new Promise((resolve, reject) => {\n      const startedAt = performance.now();\n      const sample = () => {\n        const meter = document.querySelector('.roll-timing-meter');\n        const orb = document.querySelector('.roll-timing-orb');\n        const button = document.querySelector('[data-testid=\\"roll-yut-button\\"]');\n        if (meter && orb && button instanceof HTMLButtonElement && !button.disabled) {\n          const meterRect = meter.getBoundingClientRect();\n          const orbRect = orb.getBoundingClientRect();\n          const positionPercent = meterRect.width > 0\n            ? ((orbRect.left + orbRect.width / 2 - meterRect.left) / meterRect.width) * 100\n            : -1;\n          if (positionPercent >= 47 && positionPercent <= 53) {\n            button.click();\n            resolve(positionPercent);\n            return;\n          }\n        }\n        if (performance.now() - startedAt > 8_000) {\n          reject(new Error('8초 동안 Perfect 구간에서 윷 던지기 버튼을 클릭하지 못했습니다.'));\n          return;\n        }\n        requestAnimationFrame(sample);\n      };\n      sample();\n    }));\n\n`;

if (!source.includes('const clickSequenceRollAtPerfect')) {
  const anchorIndex = source.indexOf(initAnchor, source.indexOf("test('온라인 윷 던지기는"));
  if (anchorIndex < 0) throw new Error('Sequence test init anchor was not found.');
  const insertAt = anchorIndex + initAnchor.length;
  source = source.slice(0, insertAt) + helper + source.slice(insertAt);
}

const sequenceTestStart = source.indexOf("test('온라인 윷 던지기는");
const firstDirectClick = source.indexOf("      await page.getByTestId('roll-yut-button').click();", sequenceTestStart);
if (firstDirectClick >= 0) {
  source = source.slice(0, firstDirectClick) + '      await clickSequenceRollAtPerfect();' + source.slice(firstDirectClick + "      await page.getByTestId('roll-yut-button').click();".length);
}

const oldPreview = `    await runQaStep(testInfo, '말 이동 직후 preview 제거 확인', async () => {\n      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });\n      await expect.poll(async () => {\n        const state = await collectScreenState(page);\n        if (state.moveButton.visible && !state.moveButton.disabled) return 'ready';\n        return JSON.stringify(state, null, 2);\n      }, { timeout: 20_000, message: '윷 결과 적용 후 선택한 말 이동 버튼이 활성화되어야 합니다.' }).toBe('ready');\n\n      await page.getByTestId('move-piece-button').click();`;
const newPreview = `    await runQaStep(testInfo, '말 이동 직후 preview 제거 확인', async () => {\n      await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });\n      let moveReady = false;\n      for (let attempt = 0; attempt < 5 && !moveReady; attempt += 1) {\n        let nextAction = '';\n        await expect.poll(async () => {\n          const state = await collectScreenState(page);\n          if (state.moveButton.visible && !state.moveButton.disabled) {\n            nextAction = 'move';\n            return 'ready';\n          }\n          if (state.rollButton.visible && !state.rollButton.disabled) {\n            nextAction = 'roll';\n            return 'ready';\n          }\n          return JSON.stringify(state, null, 2);\n        }, { timeout: 45_000, message: '윷 결과가 이동 가능 상태가 되거나 이동 불가 빽도 후 다음 던지기 차례로 복귀해야 합니다.' }).toBe('ready');\n        if (nextAction === 'move') {\n          moveReady = true;\n          break;\n        }\n        await clickSequenceRollAtPerfect();\n        await expect(page.locator('.roll-stage')).toBeHidden({ timeout: 10_000 });\n      }\n      expect(moveReady, 'Perfect 구간에서 반복 던진 뒤 말 이동 버튼이 활성화되어야 합니다.').toBe(true);\n\n      await page.getByTestId('move-piece-button').click();`;

if (source.includes(oldPreview)) source = source.replace(oldPreview, newPreview);
else if (!source.includes("let moveReady = false;\n      for (let attempt = 0; attempt < 5 && !moveReady")) throw new Error('Preview retry target was not found.');

writeFileSync(path, source);
console.log('Applied deterministic Perfect/retry handling to the sequence preview test.');
