import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createQaPlaywrightArgs } from '../qa/playwright-command.mjs';
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
  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
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
    child.once('error', (error) => {
      const message = `${command} 실행 실패: ${error instanceof Error ? error.stack || error.message : String(error)}\n`;
      process.stderr.write(message);
      log.write(message);
      finish(1);
    });
    child.once('close', (code) => finish(code));
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

console.log(`QA emulator suite group=${selectedGroup}, project=${qaProjectId}, run=${qaRunId}, workers=${suite.workers}, projects=${suite.projects.join(',')}`);
await record('Verify emulator runtime', process.execPath, ['.github/scripts/verify-qa-emulator-config.mjs', '--runtime'], 'qa-emulator-guard.log');
await cleanup('Cleanup current QA namespace before tests', 'qa-cleanup-before.log', true);

if (failures.length === 0) {
  await record(
    `QA ${suite.label}`,
    'npx',
    createQaPlaywrightArgs(selectedGroup),
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
