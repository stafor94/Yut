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

const cleanup = async (label, logPath, role, reportRemaining = false) => {
  await record(
    label,
    process.execPath,
    ['tests/helpers/cleanup-qa-rooms.js'],
    logPath,
    {
      QA_ROLE: role,
      QA_CLEANUP_MODE: 'current-run',
      ...(reportRemaining ? { QA_CLEANUP_REPORT_REMAINING: '1' } : {}),
    },
  );
};

const runSuite = async ({ label, script, output, log, role, extraArgs = [] }) => {
  await cleanup(`${label} 사전 cleanup`, `qa-cleanup-before-${role}.log`, role);
  await record(
    label,
    'npm',
    ['run', script, '--', ...extraArgs, `--output=test-results/${output}`],
    log,
    { QA_ROLE: role },
  );
  await cleanup(`${label} 사후 cleanup`, `qa-cleanup-after-${role}.log`, role, true);
};

await record('Verify emulator runtime', process.execPath, ['.github/scripts/verify-qa-emulator-config.mjs', '--runtime'], 'qa-emulator-guard.log');
await cleanup('Cleanup current QA namespace before tests', 'qa-cleanup-before.log', 'emulator-preflight', true);

if (failures.length === 0) {
  await record(
    'Browser Firebase isolation guard',
    'npx',
    ['playwright', 'test', '--workers=1', '--project=desktop-chromium', '--output=test-results/firebase-isolation', 'tests/smoke/firebase-emulator-isolation.spec.js'],
    'playwright-qa-firebase-isolation.log',
    { QA_ROLE: 'firebase-isolation' },
  );

  await runSuite({
    label: 'QA online game flow',
    script: 'test:qa-basic-flow',
    output: 'online-game-flow',
    log: 'playwright-qa-online-game-flow.log',
    role: 'online-game-flow',
  });
  await runSuite({
    label: 'QA online room lifecycle',
    script: 'test:qa-room-lifecycle',
    output: 'online-room-lifecycle',
    log: 'playwright-qa-online-room-lifecycle.log',
    role: 'online-room-lifecycle',
  });
  await runSuite({
    label: 'QA roll and movement',
    script: 'test:qa-online-turn-recovery',
    output: 'roll-movement',
    log: 'playwright-qa-roll-movement.log',
    role: 'roll-movement',
  });
  await runSuite({
    label: 'QA desktop lobby',
    script: 'test:qa-cleanup-layout-regression',
    output: 'lobby-desktop',
    log: 'playwright-qa-lobby-desktop.log',
    role: 'lobby-desktop',
  });
  await runSuite({
    label: 'QA Galaxy layout',
    script: 'test:qa-mobile-layout',
    output: 'mobile-galaxy',
    log: 'playwright-qa-mobile-galaxy.log',
    role: 'mobile-galaxy',
    extraArgs: ['--project=mobile-galaxy'],
  });
}

await cleanup('Cleanup current QA namespace after tests', 'qa-cleanup-after.log', 'emulator-final', true);

if (failures.length > 0) {
  console.error(`QA emulator suite failed: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`QA emulator suite passed for project=${qaProjectId}, run=${qaRunId}`);
}
