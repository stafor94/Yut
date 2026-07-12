import fs from 'node:fs';
import { spawn } from 'node:child_process';

const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const qaProjectId = String(process.env.QA_PROJECT_ID ?? '').trim();
if (!qaRunId || !qaProjectId.startsWith('demo-')) throw new Error('격리된 QA_RUN_ID와 demo-* QA_PROJECT_ID가 필요합니다.');

async function runCommand(label, command, args, logPath, extraEnv = {}) {
  console.log(`\n===== ${label} =====`);
  const log = fs.createWriteStream(logPath, { flags: 'w' });
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
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
  return Number(exitCode ?? 1);
}

const failures = [];
const record = async (label, command, args, logPath, extraEnv) => {
  const code = await runCommand(label, command, args, logPath, extraEnv);
  if (code !== 0) failures.push(`${label} (exit ${code})`);
};

await record('Verify emulator runtime', process.execPath, ['.github/scripts/verify-qa-emulator-config.mjs', '--runtime'], 'qa-emulator-guard.log');
await record('Cleanup current QA namespace before tests', process.execPath, ['tests/helpers/cleanup-qa-rooms.js'], 'qa-cleanup-before.log');

if (failures.length === 0) {
  await record('Browser Firebase isolation guard', 'npx', ['playwright', 'test', '--workers=1', '--project=desktop-chromium', '--output=test-results/firebase-isolation', 'tests/smoke/firebase-emulator-isolation.spec.js'], 'playwright-qa-firebase-isolation.log');
  await record('QA basic flow', 'npm', ['run', 'test:qa-basic-flow', '--', '--output=test-results/basic-flow'], 'playwright-qa-basic-flow.log');
  await record('QA room lifecycle', 'npm', ['run', 'test:qa-room-lifecycle', '--', '--output=test-results/room-lifecycle'], 'playwright-qa-room-lifecycle.log');
  await record('QA online turn recovery', 'npm', ['run', 'test:qa-online-turn-recovery', '--', '--output=test-results/online-turn-recovery'], 'playwright-qa-online-turn-recovery.log');
  await record('QA desktop lobby regression', 'npm', ['run', 'test:qa-cleanup-layout-regression', '--', '--output=test-results/lobby-regression'], 'playwright-qa-lobby-regression.log');
  await record('QA mobile layout', 'npm', ['run', 'test:qa-mobile-layout', '--', '--output=test-results/mobile-layout'], 'playwright-qa-mobile-layout.log');
}

await record(
  'Cleanup current QA namespace after tests',
  process.execPath,
  ['tests/helpers/cleanup-qa-rooms.js'],
  'qa-cleanup-after.log',
  { QA_CLEANUP_REPORT_REMAINING: '1' },
);

if (failures.length > 0) {
  console.error(`QA emulator suite failed: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`QA emulator suite passed for project=${qaProjectId}, run=${qaRunId}`);
}
