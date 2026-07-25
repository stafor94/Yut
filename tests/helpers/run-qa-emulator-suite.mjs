import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { getQaSuite, qaSuiteNames } from '../qa/suite-manifest.mjs';

const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const qaProjectId = String(process.env.QA_PROJECT_ID ?? '').trim();
if (!qaRunId || !qaProjectId.startsWith('demo-')) throw new Error('격리된 QA_RUN_ID와 demo-* QA_PROJECT_ID가 필요합니다.');

const qaNodeOptions = [
  '--import=./tests/helpers/qa-emulator-fetch-shim.mjs',
  String(process.env.NODE_OPTIONS ?? '').trim(),
].filter(Boolean).join(' ');

const groupIndex = process.argv.indexOf('--group');
const selectedGroup = groupIndex >= 0 ? String(process.argv[groupIndex + 1] ?? '').trim() : '';
if (!selectedGroup) throw new Error(`QA group이 필요합니다. 허용: ${qaSuiteNames.join(', ')}`);
const suite = getQaSuite(selectedGroup);

const failures = [];
const durations = [];

async function runCommand(label, command, args, logPath, extraEnv = {}) {
  console.log(`\n===== ${label} =====`);
  const startedAt = Date.now();
  const log = fs.createWriteStream(logPath, { flags: 'w' });
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        NODE_OPTIONS: qaNodeOptions,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });
    child.once('error', reject);
    child.once('close', resolve);
  });
  log.end();
  const durationMs = Date.now() - startedAt;
  durations.push({ label, durationMs, exitCode: Number(exitCode ?? 1) });
  console.log(`===== ${label} completed in ${(durationMs / 1000).toFixed(1)}s =====`);
  return Number(exitCode ?? 1);
}

async function record(label, command, args, logPath, extraEnv) {
  const code = await runCommand(label, command, args, logPath, extraEnv);
  if (code !== 0) failures.push(`${label} (exit ${code})`);
}

async function cleanup(label, logPath, reportRemaining = false) {
  await record(
    label,
    process.execPath,
    ['tests/helpers/cleanup-qa-rooms.js'],
    logPath,
    {
      QA_ROLE: selectedGroup,
      QA_CLEANUP_MODE: 'current-run',
      ...(reportRemaining ? { QA_CLEANUP_REPORT_REMAINING: '1' } : {}),
    },
  );
}

function makePlaywrightArgs() {
  const args = [
    'playwright',
    'test',
    `--workers=${suite.workers}`,
    `--output=test-results/${selectedGroup}`,
  ];
  if (suite.timeoutMs) args.push(`--timeout=${suite.timeoutMs}`);
  if (suite.grepInvert) args.push('--grep-invert', suite.grepInvert);
  for (const projectName of suite.projects) args.push(`--project=${projectName}`);
  args.push(...suite.tests);
  return args;
}

console.log(`QA emulator suite group=${selectedGroup}, project=${qaProjectId}, run=${qaRunId}, workers=${suite.workers}, projects=${suite.projects.join(',')}`);
await record('Verify emulator runtime', process.execPath, ['.github/scripts/verify-qa-emulator-config.mjs', '--runtime'], 'qa-emulator-guard.log');
await cleanup('Cleanup current QA namespace before tests', 'qa-cleanup-before.log', true);

if (failures.length === 0 && suite.browserIsolationGuard) {
  await record(
    'Browser Firebase isolation guard',
    'npx',
    ['playwright', 'test', '--workers=1', '--project=desktop-chromium', '--output=test-results/firebase-isolation', 'tests/smoke/firebase-emulator-isolation.spec.js'],
    'playwright-qa-firebase-isolation.log',
    { QA_ROLE: `${selectedGroup}-firebase-isolation` },
  );
}

if (failures.length === 0) {
  await record(
    `QA ${suite.label}`,
    'npx',
    makePlaywrightArgs(),
    `playwright-qa-${selectedGroup}.log`,
    { QA_ROLE: selectedGroup },
  );
}

await cleanup('Cleanup current QA namespace after tests', 'qa-cleanup-after.log', true);
fs.writeFileSync('qa-duration.json', `${JSON.stringify({ group: selectedGroup, workers: suite.workers, projects: suite.projects, durations }, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`QA emulator suite group=${selectedGroup} failed: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`QA emulator suite group=${selectedGroup} passed for project=${qaProjectId}, run=${qaRunId}`);
}
