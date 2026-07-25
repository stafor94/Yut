import fs from 'node:fs';
import path from 'node:path';
import { qaPerformanceBudget } from '../../tests/qa/performance-budget.mjs';

const enforceOnly = process.argv.includes('--enforce-only');
const repository = String(process.env.GITHUB_REPOSITORY ?? '').trim();
const runId = String(process.env.GITHUB_RUN_ID ?? '').trim();
const token = String(process.env.GITHUB_TOKEN ?? '').trim();
const directoryByLane = Object.freeze({
  'online-core': 'core',
  'desktop-sequence': 'seq',
  'desktop-regression': 'desk',
  'mobile-galaxy': 'galaxy',
  'safari-timing': 'safari',
});

if (!repository || !runId || !token) {
  throw new Error('QA 성능 평가에는 GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_TOKEN이 필요합니다.');
}

const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  },
});
if (!response.ok) {
  throw new Error(`workflow Run 시작 시각 조회 실패: ${response.status} ${await response.text()}`);
}
const run = await response.json();
const startedAt = new Date(run.run_started_at || run.created_at || '');
if (!Number.isFinite(startedAt.getTime())) throw new Error('workflow Run 시작 시각을 해석할 수 없습니다.');

const measuredAt = new Date();
const workflowSeconds = Math.max(0, (measuredAt.getTime() - startedAt.getTime()) / 1_000);
const workflowBudget = qaPerformanceBudget.workflow;
const workflowStatus = workflowSeconds <= workflowBudget.targetSeconds
  ? 'normal'
  : workflowSeconds <= workflowBudget.hardLimitSeconds ? 'warning' : 'failure';

const lanes = Object.entries(directoryByLane).map(([laneName, directory]) => {
  const filePath = path.join(directory, 'qa-duration.json');
  let actualSeconds = null;
  if (fs.existsSync(filePath)) {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const testDuration = Array.isArray(payload.durations)
      ? payload.durations.find((entry) => String(entry.label ?? '').startsWith('QA '))
      : null;
    if (testDuration && Number.isFinite(Number(testDuration.durationMs))) actualSeconds = Number(testDuration.durationMs) / 1_000;
  }
  const targetSeconds = qaPerformanceBudget.lanes[laneName].targetSeconds;
  return {
    laneName,
    directory,
    actualSeconds,
    targetSeconds,
    status: actualSeconds === null ? 'unavailable' : actualSeconds <= targetSeconds ? 'normal' : 'warning',
  };
});

const report = {
  runId: Number(runId),
  headSha: run.head_sha ?? '',
  startedAt: startedAt.toISOString(),
  measuredAt: measuredAt.toISOString(),
  workflow: {
    actualSeconds: Number(workflowSeconds.toFixed(1)),
    targetSeconds: workflowBudget.targetSeconds,
    hardLimitSeconds: workflowBudget.hardLimitSeconds,
    status: workflowStatus,
  },
  lanes: lanes.map((lane) => ({
    ...lane,
    actualSeconds: lane.actualSeconds === null ? null : Number(lane.actualSeconds.toFixed(1)),
  })),
};

const statusText = Object.freeze({ normal: '정상', warning: '경고', failure: '초과', unavailable: '미확인' });
const secondsText = (value) => value === null ? '미확인' : `${value.toFixed(1)}초`;
const markdown = [
  '## QA 성능 예산',
  '',
  '| 항목 | 실제 | 목표 | 판정 |',
  '|---|---:|---:|---|',
  `| Workflow wall-clock | ${workflowSeconds.toFixed(1)}초 | ${workflowBudget.targetSeconds}초 · hard ${workflowBudget.hardLimitSeconds}초 | ${statusText[workflowStatus]} |`,
  ...lanes.map((lane) => `| ${lane.laneName} Playwright | ${secondsText(lane.actualSeconds)} | ${lane.targetSeconds}초 | ${statusText[lane.status]} |`),
  '',
  `측정 구간: ${startedAt.toISOString()} → ${measuredAt.toISOString()}`,
  '',
].join('\n');

if (!enforceOnly) {
  fs.writeFileSync('qa-performance.json', `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync('qa-performance.md', markdown);
  const stepSummary = String(process.env.GITHUB_STEP_SUMMARY ?? '').trim();
  if (stepSummary) fs.appendFileSync(stepSummary, markdown);
  process.stdout.write(markdown);
} else {
  console.log(`QA workflow wall-clock ${workflowSeconds.toFixed(1)}s / hard limit ${workflowBudget.hardLimitSeconds}s`);
}

if (workflowStatus === 'failure') {
  console.error(`QA workflow 성능 예산 초과: ${workflowSeconds.toFixed(1)}초 > ${workflowBudget.hardLimitSeconds}초`);
  process.exit(1);
}
