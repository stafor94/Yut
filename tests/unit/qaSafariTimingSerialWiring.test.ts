import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifestSource = readFileSync('tests/qa/suite-manifest.mjs', 'utf8');

const getSuiteBlock = (suiteName: string, nextSuiteName: string) => (
  manifestSource.match(new RegExp(`'${suiteName}': Object\\.freeze\\(\\{([\\s\\S]*?)\\n  \\}\\),\\n  '${nextSuiteName}'`, 'u'))?.[1] ?? ''
);

test('Safari timing은 WebKit emulator 연결 안정성을 위해 단일 worker로 전체 timing 계약을 실행한다', () => {
  const safariVisibleBlock = getSuiteBlock('safari-visible-mismatch', 'safari-timing');
  const safariTimingBlock = manifestSource.match(/'safari-timing': Object\.freeze\(\{([\s\S]*?)\n  \}\),\n\}\);/u)?.[1] ?? '';

  assert.match(safariVisibleBlock, /workers:\s*1/);
  assert.match(safariTimingBlock, /workers:\s*1/);
  assert.match(safariTimingBlock, /browsers:\s*Object\.freeze\(\['webkit'\]\)/);
  assert.match(safariTimingBlock, /projects:\s*Object\.freeze\(\['mobile-webkit-timing'\]\)/);
  assert.match(safariTimingBlock, /browserIsolationTest:\s*'tests\/smoke\/firebase-emulator-isolation\.spec\.js'/);
  assert.match(safariTimingBlock, /grepInvert:\s*timingPointerDownSnapshotTitle/);
  assert.match(safariTimingBlock, /sharedTargets:\s*Object\.freeze\(\[timingPointerSpec\]\)/);
  assert.match(safariTimingBlock, /tests:\s*Object\.freeze\(\[timingPointerSpec\]\)/);
});
