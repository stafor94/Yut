import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const QA_PERFORMANCE_BUDGETS_MS = Object.freeze({
  overall: 300_000,
  summaryReserve: 10_000,
  build: 90_000,
  core: 270_000,
  seq: 225_000,
  desk: 295_000,
  galaxy: 285_000,
  safvis: 195_000,
  safari: 225_000,
});

const laneContracts = Object.freeze([
  Object.freeze({ code: 'build', label: 'Build and unit', path: 'build/qa-job-timing.json' }),
  Object.freeze({ code: 'core', label: 'QA online core', path: 'core/qa-job-timing.json' }),
  Object.freeze({ code: 'seq', label: 'QA desktop sequence replay', path: 'seq/qa-job-timing.json' }),
  Object.freeze({ code: 'desk', label: 'QA desktop regression', path: 'desk/qa-job-timing.json' }),
  Object.freeze({ code: 'galaxy', label: 'QA mobile Galaxy', path: 'galaxy/qa-job-timing.json' }),
  Object.freeze({ code: 'safvis', label: 'QA Safari visible mismatch', path: 'safvis/qa-job-timing.json' }),
  Object.freeze({ code: 'safari', label: 'QA Safari timing', path: 'safari/qa-job-timing.json' }),
]);

const formatDuration = (durationMs) => `${(durationMs / 1000).toFixed(1)}s`;

export function validateQaPerformance({ workflowStartedAtMs, measuredAtMs, laneTimings }) {
  const failures = [];
  const lanes = laneContracts.map((contract) => {
    const timing = laneTimings[contract.code];
    const budgetMs = QA_PERFORMANCE_BUDGETS_MS[contract.code];
    if (!timing || !Number.isFinite(timing.durationMs)) {
      failures.push(`${contract.label}: lane 전체 실행 시간 보고서가 없습니다.`);
      return { ...contract, durationMs: null, budgetMs, passed: false };
    }
    const durationMs = Number(timing.durationMs);
    const passed = durationMs <= budgetMs;
    if (!passed) failures.push(`${contract.label}: ${formatDuration(durationMs)} > 예산 ${formatDuration(budgetMs)}`);
    return { ...contract, durationMs, budgetMs, passed };
  });

  if (!Number.isFinite(workflowStartedAtMs)) failures.push('GitHub Actions workflow 시작 시각을 확인하지 못했습니다.');
  const elapsedMs = Number.isFinite(workflowStartedAtMs) ? Math.max(0, measuredAtMs - workflowStartedAtMs) : null;
  const projectedCompletionMs = elapsedMs === null ? null : elapsedMs + QA_PERFORMANCE_BUDGETS_MS.summaryReserve;
  if (projectedCompletionMs !== null && projectedCompletionMs > QA_PERFORMANCE_BUDGETS_MS.overall) {
    failures.push(`전체 QA 예상 완료 시간: ${formatDuration(projectedCompletionMs)} > 목표 ${formatDuration(QA_PERFORMANCE_BUDGETS_MS.overall)}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    measuredAt: new Date(measuredAtMs).toISOString(),
    workflowStartedAt: Number.isFinite(workflowStartedAtMs) ? new Date(workflowStartedAtMs).toISOString() : null,
    overall: {
      elapsedMs,
      summaryReserveMs: QA_PERFORMANCE_BUDGETS_MS.summaryReserve,
      projectedCompletionMs,
      budgetMs: QA_PERFORMANCE_BUDGETS_MS.overall,
      passed: projectedCompletionMs !== null && projectedCompletionMs <= QA_PERFORMANCE_BUDGETS_MS.overall,
    },
    lanes,
  };
}

function renderMarkdown(report) {
  const lines = [
    '## QA 성능 예산',
    '',
    '| 단계 | 전체 실행 시간 | 예산 | 결과 |',
    '|---|---:|---:|---|',
  ];
  for (const lane of report.lanes) {
    lines.push(`| ${lane.label} | ${lane.durationMs === null ? 'unavailable' : formatDuration(lane.durationMs)} | ${formatDuration(lane.budgetMs)} | ${lane.passed ? '`success`' : '`failure`'} |`);
  }
  lines.push(
    `| Workflow 시작 → summary 예상 완료 | ${report.overall.projectedCompletionMs === null ? 'unavailable' : formatDuration(report.overall.projectedCompletionMs)} | ${formatDuration(report.overall.budgetMs)} | ${report.overall.passed ? '`success`' : '`failure`'} |`,
    '',
  );
  if (report.failures.length > 0) {
    lines.push('### 성능 차단 사유', '', ...report.failures.map((failure) => `- ${failure}`), '');
  }
  return `${lines.join('\n')}\n`;
}

function readLaneTimings(root) {
  return Object.fromEntries(laneContracts.flatMap((contract) => {
    const timingPath = path.join(root, contract.path);
    if (!fs.existsSync(timingPath)) return [];
    try {
      return [[contract.code, JSON.parse(fs.readFileSync(timingPath, 'utf8'))]];
    } catch (error) {
      return [[contract.code, { parseError: error instanceof Error ? error.message : String(error) }]];
    }
  }));
}

async function fetchWorkflowStartedAtMs() {
  const repository = String(process.env.GITHUB_REPOSITORY ?? '').trim();
  const runId = String(process.env.GITHUB_RUN_ID ?? '').trim();
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  if (!repository || !runId || !token) return Number.NaN;
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`workflow run 조회 실패: HTTP ${response.status}`);
  const run = await response.json();
  const startedAt = Date.parse(run.run_started_at ?? run.created_at ?? '');
  return Number.isFinite(startedAt) ? startedAt : Number.NaN;
}

function runSelfTest() {
  const laneTimings = Object.fromEntries(laneContracts.map(({ code }) => [code, { durationMs: QA_PERFORMANCE_BUDGETS_MS[code] - 1 }]));
  const passReport = validateQaPerformance({ workflowStartedAtMs: 0, measuredAtMs: 289_999, laneTimings });
  assert.equal(passReport.passed, true);

  const laneFailure = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: { ...laneTimings, safari: { durationMs: QA_PERFORMANCE_BUDGETS_MS.safari + 1 } },
  });
  assert.equal(laneFailure.passed, false);
  assert.match(laneFailure.failures.join('\n'), /Safari timing/u);

  const overallFailure = validateQaPerformance({ workflowStartedAtMs: 0, measuredAtMs: 290_001, laneTimings });
  assert.equal(overallFailure.passed, false);
  assert.match(overallFailure.failures.join('\n'), /전체 QA 예상 완료 시간/u);
  console.log('QA performance validator self-test passed');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const root = process.cwd();
  let workflowStartedAtMs = Number.NaN;
  let apiError = null;
  try {
    workflowStartedAtMs = await fetchWorkflowStartedAtMs();
  } catch (error) {
    apiError = error instanceof Error ? error.message : String(error);
  }
  const report = validateQaPerformance({
    workflowStartedAtMs,
    measuredAtMs: Date.now(),
    laneTimings: readLaneTimings(root),
  });
  if (apiError) report.failures.unshift(apiError);
  report.passed = report.failures.length === 0;

  fs.writeFileSync('qa-performance.json', `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync('qa-performance.md', renderMarkdown(report));
  console.log(renderMarkdown(report));
  if (!report.passed) process.exitCode = 1;
}

await main();
