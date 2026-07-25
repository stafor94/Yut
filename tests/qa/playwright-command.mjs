import { getQaSuite } from './suite-manifest.mjs';

export function createQaPlaywrightArgs(suiteName) {
  const suite = getQaSuite(suiteName);
  const args = [
    'playwright',
    'test',
    `--workers=${suite.workers}`,
    `--output=test-results/${suiteName}`,
  ];
  if (suite.timeoutMs) args.push(`--timeout=${suite.timeoutMs}`);
  if (suite.grepInvert) args.push('--grep-invert', suite.grepInvert);
  for (const projectName of suite.projects) args.push(`--project=${projectName}`);
  args.push(suite.browserIsolationTest, ...suite.tests);
  return args;
}
