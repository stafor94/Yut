import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const QA_PERFORMANCE_TARGETS_MS = Object.freeze({
  overall: 300_000,
  summaryReserve: 10_000,
  build: 90_000,
  core: 270_000,
  seq: 225_000,
  desk: 295_000,
  galaxy: 240_000,
  galtime: 240_000,
  galack: 210_000,
  galstart: 120_000,
  safvis: 195_000,
  safari: 250_000,
});

export const QA_PERFORMANCE_ISSUE_THRESHOLDS_MS = Object.freeze({
  galtime: 300_000,
  galack: 240_000,
  galstart: 150_000,
});

export const QA_PERFORMANCE_EMERGENCY_LIMITS_MS = Object.freeze({
  overall: 370_000,
  build: 120_000,
  core: 320_000,
  seq: 270_000,
  desk: 345_000,
  galaxy: 285_000,
  galtime: 360_000,
  galack: 360_000,
  galstart: 360_000,
  safvis: 240_000,
  safari: 300_000,
});

// 기존 import 계약을 유지하되, hard limit은 이제 비정상 지연 차단 한계를 뜻합니다.
export const QA_PERFORMANCE_HARD_LIMITS_MS = QA_PERFORMANCE_EMERGENCY_LIMITS_MS;
// 기존 import 계약을 유지하되, budget은 이제 관찰 목표를 뜻합니다.
export const QA_PERFORMANCE_BUDGETS_MS = QA_PERFORMANCE_TARGETS_MS;

const laneContracts = Object.freeze([
  Object.freeze({ code: 'build', label: 'Build and unit', jobPath: 'build/qa-job-timing.json', testPath: null }),
  Object.freeze({ code: 'core', label: 'QA online core', jobPath: 'core/qa-job-timing.json', testPath: 'core/qa-duration.json' }),
  Object.freeze({ code: 'seq', label: 'QA desktop sequence replay', jobPath: 'seq/qa-job-timing.json', testPath: 'seq/qa-duration.json' }),
  Object.freeze({ code: 'desk', label: 'QA desktop regression', jobPath: 'desk/qa-job-timing.json', testPath: 'desk/qa-duration.json' }),
  Object.freeze({ code: 'galaxy', label: 'QA mobile Galaxy', jobPath: 'galaxy/qa-job-timing.json', testPath: 'galaxy/qa-duration.json' }),
  Object.freeze({ code: 'galtime', label: 'QA mobile Galaxy timing', jobPath: 'galtime/qa-job-timing.json', testPath: 'galtime/qa-duration.json' }),
  Object.freeze({ code: 'galack', label: 'QA mobile Galaxy move ACK', jobPath: 'galack/qa-job-timing.json', testPath: 'galack/qa-duration.json' }),
  Object.freeze({ code: 'galstart', label: 'QA mobile Galaxy move start', jobPath: 'galstart/qa-job-timing.json', testPath: 'galstart/qa-duration.json' }),
  Object.freeze({ code: 'safvis', label: 'QA Safari visible mismatch', jobPath: 'safvis/qa-job-timing.json', testPath: 'safvis/qa-duration.json' }),
  Object.freeze({ code: 'safari', label: 'QA Safari timing', jobPath: 'safari/qa-job-timing.json', testPath: 'safari/qa-duration.json' }),
]);

const formatDuration = (durationMs) => `${(durationMs / 1000).toFixed(1)}s`;

function classifyDuration(durationMs, targetMs, emergencyLimitMs) {
  if (durationMs > emergencyLimitMs) return 'failure';
  if (durationMs > targetMs) return 'warning';
  return 'success';
}

function normalizeLaneTiming(timing) {
  if (!timing || typeof timing !== 'object') return null;
  const durationMs = Number(timing.durationMs ?? timing.jobDurationMs);
  const rawTestDurationMs = timing.testDurationMs;
  const testDurationMs = rawTestDurationMs === null || rawTestDurationMs === undefined ? null : Number(rawTestDurationMs);
  return {
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    testDurationMs: Number.isFinite(testDurationMs) ? testDurationMs : null,
  };
}

export function validateQaPerformance({ workflowStartedAtMs, measuredAtMs, laneTimings }) {
  const failures = [];
  const warnings = [];
  const performanceIssueCandidates = [];
  const lanes = laneContracts.map((contract) => {
    const timing = normalizeLaneTiming(laneTimings[contract.code]);
    const targetMs = QA_PERFORMANCE_TARGETS_MS[contract.code];
    const issueThresholdMs = QA_PERFORMANCE_ISSUE_THRESHOLDS_MS[contract.code] ?? null;
    const emergencyLimitMs = QA_PERFORMANCE_EMERGENCY_LIMITS_MS[contract.code];
    const durationMs = timing?.durationMs ?? null;
    const testDurationMs = contract.testPath ? timing?.testDurationMs ?? null : null;
    if (durationMs === null) failures.push(`${contract.label}: lane 전체 실행 시간 보고서가 없습니다.`);
    if (contract.testPath && testDurationMs === null) failures.push(`${contract.label}: 실제 테스트 실행 시간 보고서가 없습니다.`);

    const blockingDurationMs = contract.testPath ? testDurationMs : durationMs;
    const status = blockingDurationMs === null ? 'failure' : classifyDuration(blockingDurationMs, targetMs, emergencyLimitMs);
    const targetExceeded = blockingDurationMs !== null && blockingDurationMs > targetMs;
    const issueEligible = blockingDurationMs !== null && issueThresholdMs !== null && blockingDurationMs > issueThresholdMs;
    const emergencyExceeded = blockingDurationMs !== null && blockingDurationMs > emergencyLimitMs;
    if (blockingDurationMs !== null) {
      if (status === 'failure') {
        failures.push(`${contract.label}: 실제 검증 시간 ${formatDuration(blockingDurationMs)} > 비상 차단 한계 ${formatDuration(emergencyLimitMs)}`);
      } else if (issueEligible) {
        warnings.push(`${contract.label}: 실제 검증 시간 ${formatDuration(blockingDurationMs)} > 반복 이슈 기준 ${formatDuration(issueThresholdMs)} (비상 차단 한계 ${formatDuration(emergencyLimitMs)} 이내)`);
      } else if (status === 'warning') {
        const repeatDetail = issueThresholdMs === null ? '' : ` (반복 이슈 기준 ${formatDuration(issueThresholdMs)} 미만)`;
        warnings.push(`${contract.label}: 실제 검증 시간 ${formatDuration(blockingDurationMs)} > 목표 ${formatDuration(targetMs)}${repeatDetail}`);
      }
    }

    if (issueEligible) {
      performanceIssueCandidates.push({
        category: 'performance',
        laneCode: contract.code,
        laneLabel: contract.label,
        fingerprint: `performance|${contract.code}|duration-threshold`,
        observedMs: blockingDurationMs,
        targetMs,
        issueThresholdMs,
        emergencyLimitMs,
        blocking: emergencyExceeded,
      });
    }

    const jobStatus = durationMs === null ? 'failure' : durationMs > targetMs ? 'warning' : 'success';
    if (durationMs !== null && durationMs > targetMs) {
      warnings.push(`${contract.label}: runner 준비·설치 포함 전체 시간 ${formatDuration(durationMs)} > 목표 ${formatDuration(targetMs)} (실제 검증 시간 ${blockingDurationMs === null ? 'unavailable' : formatDuration(blockingDurationMs)})`);
    }

    return {
      ...contract,
      durationMs,
      testDurationMs,
      blockingDurationMs,
      targetMs,
      issueThresholdMs,
      emergencyLimitMs,
      hardLimitMs: emergencyLimitMs,
      targetPassed: blockingDurationMs !== null && blockingDurationMs <= targetMs,
      targetExceeded,
      issueEligible,
      emergencyExceeded,
      emergencyLimitPassed: blockingDurationMs !== null && blockingDurationMs <= emergencyLimitMs,
      hardLimitPassed: blockingDurationMs !== null && blockingDurationMs <= emergencyLimitMs,
      status,
      jobStatus,
    };
  });

  const blockingDurations = lanes.map((lane) => lane.blockingDurationMs).filter(Number.isFinite);
  const criticalPathMs = blockingDurations.length === lanes.length ? Math.max(...blockingDurations) : null;
  const projectedCompletionMs = criticalPathMs === null ? null : criticalPathMs + QA_PERFORMANCE_TARGETS_MS.summaryReserve;
  const overallStatus = projectedCompletionMs === null
    ? 'failure'
    : classifyDuration(projectedCompletionMs, QA_PERFORMANCE_TARGETS_MS.overall, QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall);
  if (overallStatus === 'failure' && projectedCompletionMs !== null) {
    failures.push(`실제 검증 critical path 예상 완료 시간: ${formatDuration(projectedCompletionMs)} > 비상 차단 한계 ${formatDuration(QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall)}`);
  } else if (overallStatus === 'warning' && projectedCompletionMs !== null) {
    warnings.push(`실제 검증 critical path 예상 완료 시간: ${formatDuration(projectedCompletionMs)} > 목표 ${formatDuration(QA_PERFORMANCE_TARGETS_MS.overall)} (비상 차단 한계 ${formatDuration(QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall)} 이내)`);
  }

  if (!Number.isFinite(workflowStartedAtMs)) failures.push('GitHub Actions workflow 시작 시각을 확인하지 못했습니다.');
  const elapsedMs = Number.isFinite(workflowStartedAtMs) ? Math.max(0, measuredAtMs - workflowStartedAtMs) : null;
  const wallClockProjectedCompletionMs = elapsedMs === null ? null : elapsedMs + QA_PERFORMANCE_TARGETS_MS.summaryReserve;
  const wallClockStatus = wallClockProjectedCompletionMs === null
    ? 'failure'
    : wallClockProjectedCompletionMs > QA_PERFORMANCE_TARGETS_MS.overall ? 'warning' : 'success';
  if (wallClockStatus === 'warning' && wallClockProjectedCompletionMs !== null) {
    warnings.push(`runner 준비·설치 포함 workflow 예상 완료 시간: ${formatDuration(wallClockProjectedCompletionMs)} > 목표 ${formatDuration(QA_PERFORMANCE_TARGETS_MS.overall)} (관찰 전용)`);
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    performanceIssueCandidates,
    measuredAt: new Date(measuredAtMs).toISOString(),
    workflowStartedAt: Number.isFinite(workflowStartedAtMs) ? new Date(workflowStartedAtMs).toISOString() : null,
    overall: {
      elapsedMs,
      summaryReserveMs: QA_PERFORMANCE_TARGETS_MS.summaryReserve,
      criticalPathMs,
      projectedCompletionMs,
      wallClockProjectedCompletionMs,
      targetMs: QA_PERFORMANCE_TARGETS_MS.overall,
      emergencyLimitMs: QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall,
      hardLimitMs: QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall,
      targetPassed: projectedCompletionMs !== null && projectedCompletionMs <= QA_PERFORMANCE_TARGETS_MS.overall,
      emergencyLimitPassed: projectedCompletionMs !== null && projectedCompletionMs <= QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall,
      hardLimitPassed: projectedCompletionMs !== null && projectedCompletionMs <= QA_PERFORMANCE_EMERGENCY_LIMITS_MS.overall,
      status: overallStatus,
      wallClockStatus,
    },
    lanes,
  };
}

function renderStatus(status) {
  return `\`${status}\``;
}

function renderThreshold(issueThresholdMs) {
  return issueThresholdMs === null ? '-' : formatDuration(issueThresholdMs);
}

function renderMarkdown(report) {
  const lines = [
    '## QA 성능 목표',
    '',
    '측정 누락과 비상 차단 한계 초과만 workflow를 실패시킵니다. Galaxy timing 계열의 반복 이슈 기준 초과는 구조화된 후보로 기록하며 단일 Run은 경고로 유지합니다.',
    '',
    '| 단계 | 실제 검증 시간 | runner 포함 전체 | 목표 | 반복 이슈 기준 | 비상 차단 한계 | 결과 |',
    '|---|---:|---:|---:|---:|---:|---|',
  ];
  for (const lane of report.lanes) {
    lines.push(`| ${lane.label} | ${lane.blockingDurationMs === null ? 'unavailable' : formatDuration(lane.blockingDurationMs)} | ${lane.durationMs === null ? 'unavailable' : formatDuration(lane.durationMs)} | ${formatDuration(lane.targetMs)} | ${renderThreshold(lane.issueThresholdMs)} | ${formatDuration(lane.emergencyLimitMs)} | ${renderStatus(lane.status)} |`);
  }
  lines.push(
    `| 실제 검증 critical path + summary | ${report.overall.projectedCompletionMs === null ? 'unavailable' : formatDuration(report.overall.projectedCompletionMs)} | - | ${formatDuration(report.overall.targetMs)} | - | ${formatDuration(report.overall.emergencyLimitMs)} | ${renderStatus(report.overall.status)} |`,
    `| Workflow wall clock + summary | - | ${report.overall.wallClockProjectedCompletionMs === null ? 'unavailable' : formatDuration(report.overall.wallClockProjectedCompletionMs)} | ${formatDuration(report.overall.targetMs)} | - | 관찰 전용 | ${renderStatus(report.overall.wallClockStatus)} |`,
    '',
  );
  if (report.performanceIssueCandidates.length > 0) {
    lines.push(
      '### 반복 성능 이슈 후보',
      '',
      ...report.performanceIssueCandidates.map((candidate) => `- \`${candidate.fingerprint}\`: ${formatDuration(candidate.observedMs)} > ${formatDuration(candidate.issueThresholdMs)}`),
      '',
    );
  }
  if (report.warnings.length > 0) {
    lines.push('### 성능 경고', '', ...report.warnings.map((warning) => `- ${warning}`), '');
  }
  if (report.failures.length > 0) {
    lines.push('### 성능 차단 사유', '', ...report.failures.map((failure) => `- ${failure}`), '');
  }
  return `${lines.join('\n')}\n`;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

function sumTestDurations(report) {
  if (!report || !Array.isArray(report.durations) || report.durations.length === 0) return null;
  const durations = report.durations.map((entry) => Number(entry?.durationMs));
  return durations.every(Number.isFinite) ? durations.reduce((sum, durationMs) => sum + durationMs, 0) : null;
}

function readLaneTimings(root) {
  return Object.fromEntries(laneContracts.map((contract) => {
    const jobTiming = readJson(path.join(root, contract.jobPath));
    const testTiming = contract.testPath ? readJson(path.join(root, contract.testPath)) : null;
    return [contract.code, {
      durationMs: jobTiming ? Number(jobTiming.durationMs) : null,
      testDurationMs: contract.testPath ? sumTestDurations(testTiming) : null,
    }];
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

function makeSelfTestTimings() {
  return Object.fromEntries(laneContracts.map(({ code, testPath }) => [code, {
    durationMs: Math.max(1, QA_PERFORMANCE_TARGETS_MS[code] - 20_000),
    testDurationMs: testPath ? Math.max(1, QA_PERFORMANCE_TARGETS_MS[code] - 20_000) : null,
  }]));
}

function withLaneTiming(laneTimings, code, testDurationMs, durationMs = testDurationMs) {
  return {
    ...laneTimings,
    [code]: {
      durationMs,
      testDurationMs,
    },
  };
}

function runSelfTest() {
  const laneTimings = makeSelfTestTimings();
  const passReport = validateQaPerformance({ workflowStartedAtMs: 0, measuredAtMs: 289_999, laneTimings });
  assert.equal(passReport.passed, true);
  assert.equal(passReport.warnings.length, 0);
  assert.deepEqual(passReport.performanceIssueCandidates, []);

  const testWarning = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'safari', QA_PERFORMANCE_TARGETS_MS.safari + 1, 500_000),
  });
  assert.equal(testWarning.passed, true);
  assert.match(testWarning.warnings.join('\n'), /실제 검증 시간/u);
  assert.match(testWarning.warnings.join('\n'), /runner 준비·설치 포함 전체 시간/u);
  assert.equal(testWarning.lanes.find(({ code }) => code === 'safari')?.status, 'warning');

  const galaxyTargetWarning = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'galtime', QA_PERFORMANCE_TARGETS_MS.galtime + 1),
  });
  assert.equal(galaxyTargetWarning.passed, true);
  assert.equal(galaxyTargetWarning.lanes.find(({ code }) => code === 'galtime')?.issueEligible, false);

  const previousHardLimitNoLongerBlocks = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'galtime', 285_001),
  });
  assert.equal(previousHardLimitNoLongerBlocks.passed, true);
  assert.equal(previousHardLimitNoLongerBlocks.performanceIssueCandidates.length, 0);

  const galaxyIssueCandidate = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'galtime', 300_001),
  });
  assert.equal(galaxyIssueCandidate.passed, true);
  assert.equal(galaxyIssueCandidate.performanceIssueCandidates[0]?.fingerprint, 'performance|galtime|duration-threshold');
  assert.equal(galaxyIssueCandidate.performanceIssueCandidates[0]?.blocking, false);

  const galaxyEmergencyBoundary = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'galtime', 360_000),
  });
  assert.equal(galaxyEmergencyBoundary.passed, true);

  const galaxyEmergencyFailure = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'galtime', 360_001),
  });
  assert.equal(galaxyEmergencyFailure.passed, false);
  assert.equal(galaxyEmergencyFailure.performanceIssueCandidates[0]?.blocking, true);
  assert.match(galaxyEmergencyFailure.failures.join('\n'), /비상 차단 한계/u);

  for (const [code, threshold] of [['galack', 240_000], ['galstart', 150_000]]) {
    const report = validateQaPerformance({
      workflowStartedAtMs: 0,
      measuredAtMs: 289_999,
      laneTimings: withLaneTiming(laneTimings, code, threshold + 1),
    });
    assert.equal(report.passed, true);
    assert.equal(report.performanceIssueCandidates[0]?.fingerprint, `performance|${code}|duration-threshold`);
  }

  const runnerVariance = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 450_000,
    laneTimings: withLaneTiming(laneTimings, 'core', 250_000, 600_000),
  });
  assert.equal(runnerVariance.passed, true);
  assert.equal(runnerVariance.overall.wallClockStatus, 'warning');
  assert.match(runnerVariance.warnings.join('\n'), /관찰 전용/u);

  const testFailure = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: withLaneTiming(laneTimings, 'safari', QA_PERFORMANCE_EMERGENCY_LIMITS_MS.safari + 1, 500_000),
  });
  assert.equal(testFailure.passed, false);
  assert.match(testFailure.failures.join('\n'), /Safari timing/u);

  const missingTestTiming = validateQaPerformance({
    workflowStartedAtMs: 0,
    measuredAtMs: 289_999,
    laneTimings: { ...laneTimings, core: { durationMs: 200_000, testDurationMs: null } },
  });
  assert.equal(missingTestTiming.passed, false);
  assert.match(missingTestTiming.failures.join('\n'), /실제 테스트 실행 시간 보고서/u);

  const missingWorkflowStart = validateQaPerformance({ workflowStartedAtMs: Number.NaN, measuredAtMs: 289_999, laneTimings });
  assert.equal(missingWorkflowStart.passed, false);
  assert.match(missingWorkflowStart.failures.join('\n'), /workflow 시작 시각/u);
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
