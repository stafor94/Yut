import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifestSource = readFileSync('tests/qa/suite-manifest.mjs', 'utf8');

const getSuiteBlock = (suiteName: string, nextSuiteName: string) => (
  manifestSource.match(new RegExp(`'${suiteName}': Object\\.freeze\\(\\{([\\s\\S]*?)\\n  \\}\\),\\n  '${nextSuiteName}'`, 'u'))?.[1] ?? ''
);

test('Safari timing pointer 계약은 단일 worker WebKit lane 두 개에 중복 없이 균형 배치한다', () => {
  const safariVisibleBlock = getSuiteBlock('safari-visible-mismatch', 'safari-timing');
  const safariTimingBlock = manifestSource.match(/'safari-timing': Object\.freeze\(\{([\s\S]*?)\n  \}\),\n\}\);/u)?.[1] ?? '';

  assert.match(safariVisibleBlock, /workers:\s*1/);
  assert.match(safariVisibleBlock, /grep:\s*`\$\{firebaseIsolationTitle\}\|\$\{timingNiceSnapshotTitle\}\|\$\{timingOverflowTitle\}`/);
  assert.match(safariVisibleBlock, /sharedTargets:\s*Object\.freeze\(\[timingPointerSpec, timingOverflowSpec\]\)/);
  assert.match(safariVisibleBlock, /tests:\s*Object\.freeze\(\[timingPointerSpec, timingOverflowSpec\]\)/);

  assert.match(safariTimingBlock, /workers:\s*1/);
  assert.match(safariTimingBlock, /browsers:\s*Object\.freeze\(\['webkit'\]\)/);
  assert.match(safariTimingBlock, /projects:\s*Object\.freeze\(\['mobile-webkit-timing'\]\)/);
  assert.match(safariTimingBlock, /browserIsolationTest:\s*'tests\/smoke\/firebase-emulator-isolation\.spec\.js'/);
  assert.match(safariTimingBlock, /grepInvert:\s*timingNiceSnapshotTitle/);
  assert.match(safariTimingBlock, /sharedTargets:\s*Object\.freeze\(\[timingPointerSpec\]\)/);
  assert.match(safariTimingBlock, /tests:\s*Object\.freeze\(\[timingPointerSpec\]\)/);
});
