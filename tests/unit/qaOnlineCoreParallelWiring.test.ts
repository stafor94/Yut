import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('online-core만 desktop Chromium file 내부 테스트를 병렬 실행한다', () => {
  const config = read('playwright.config.js');
  const runner = read('tests/helpers/run-qa-emulator-suite.mjs');
  const manifest = read('tests/qa/suite-manifest.mjs');

  assert.match(config, /const isOnlineCoreQa = String\(process\.env\.QA_ROLE \?\? ''\)\.trim\(\) === 'online-core';/);
  assert.match(config, /name: 'desktop-chromium'[\s\S]{0,240}fullyParallel: qaProjectExecutionOptions\['desktop-chromium'\]\.fullyParallel \|\| isOnlineCoreQa/);
  assert.match(config, /name: 'mobile-galaxy'[\s\S]{0,240}fullyParallel: qaProjectExecutionOptions\['mobile-galaxy'\]\.fullyParallel/);
  assert.match(config, /name: 'mobile-webkit-timing'[\s\S]{0,260}fullyParallel: qaProjectExecutionOptions\['mobile-webkit-timing'\]\.fullyParallel/);
  assert.match(runner, /createQaPlaywrightArgs\(selectedGroup\)[\s\S]{0,160}\{ QA_ROLE: selectedGroup \}/);
  assert.match(manifest, /'online-core': Object\.freeze\(\{[\s\S]{0,180}workers: 2,[\s\S]{0,120}projects: Object\.freeze\(\['desktop-chromium'\]\)/);
});
