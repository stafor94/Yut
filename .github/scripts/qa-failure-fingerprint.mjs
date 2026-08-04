import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makeFailureFingerprint, normalizeFailureText, selectPrimaryRootCause } from './build-qa-failure-report.mjs';

const LABEL = 'ci-failure';
const MARKER_PREFIX = '<!-- qa-fingerprint:v1:';
const LEGACY_MARKER = '<!-- ci-failure:main-branch-qa -->';
const MAX_HISTORY = 5;
const MAX_BODY = 60_000;

const laneLabels = Object.freeze({
  build: 'Build and unit', core: 'Online core', seq: 'Desktop sequence replay', desk: 'Desktop regression',
  galaxy: 'Mobile Galaxy', galtime: 'Mobile Galaxy timing', galack: 'Mobile Galaxy move ACK',
  galstart: 'Mobile Galaxy move start', safvis: 'Safari visible mismatch', safari: 'Safari timing', summary: 'Summary',
});

function clean(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function fingerprintParts(fingerprint) {
  const [category = 'infrastructure', lane = 'summary', source = 'unknown'] = String(fingerprint).split('|');
  return { category, lane, source };
}

export function isManagedIssue(body) {
  return String(body ?? '').includes(MARKER_PREFIX) && !String(body ?? '').includes(LEGACY_MARKER);
}

export function parseIssueMetadata(body) {
  const text = String(body ?? '');
  return {
    fingerprint: text.match(/<!-- qa-fingerprint:v1:([^>]+) -->/u)?.[1] ?? null,
    runKeys: (text.match(/<!-- qa-run-keys:([^>]*) -->/u)?.[1] ?? '').split(',').filter(Boolean),
    occurrenceCount: Number(text.match(/<!-- qa-occurrences:(\d+) -->/u)?.[1] ?? 0),
    firstRunId: text.match(/<!-- qa-first-run:([^>]+) -->/u)?.[1] ?? null,
  };
}

export function nextOccurrenceMetadata(metadata, runKey, runId) {
  const alreadyProcessed = metadata.runKeys.includes(runKey);
  return {
    alreadyProcessed,
    runKeys: alreadyProcessed ? metadata.runKeys : [...metadata.runKeys, runKey].slice(-20),
    occurrenceCount: alreadyProcessed ? metadata.occurrenceCount : metadata.occurrenceCount + 1,
    firstRunId: metadata.firstRunId ?? String(runId),
  };
}

export function chooseCanonicalIssue(issues) {
  const ordered = [...issues].sort((left, right) => left.number - right.number);
  return { canonical: ordered[0] ?? null, duplicates: ordered.slice(1) };
}

function reportCandidate(report, lane) {
  return (report?.performanceIssueCandidates ?? []).find((candidate) => candidate.laneCode === lane) ?? null;
}

export function qualifiesPerformanceIssue(reports, lane) {
  const states = reports.slice(0, MAX_HISTORY).map((report) => Boolean(reportCandidate(report, lane)));
  const current = reportCandidate(reports[0], lane);
  return Boolean(current?.blocking) || (states[0] && states[1]) || states.filter(Boolean).length >= 3;
}

export function reportStateForFingerprint(report, fingerprint) {
  const { category, lane } = fingerprintParts(fingerprint);
  if (!report) return 'unavailable';
  if (category === 'performance') {
    if (reportCandidate(report, lane)) return 'failure';
    const state = (report.laneStates ?? []).find((entry) => entry.code === lane);
    return state && Number.isFinite(state.testDurationMs ?? state.durationMs) ? 'success' : 'unavailable';
  }
  if (category === 'summary') return report.summaryResult === 'success' ? 'success' : 'failure';
  const laneState = (report.laneStates ?? []).find((entry) => entry.code === lane);
  if (!laneState) return 'unavailable';
  if (category === 'artifact') {
    const timingAvailable = lane === 'build'
      ? Number.isFinite(laneState.durationMs)
      : Number.isFinite(laneState.durationMs) && Number.isFinite(laneState.testDurationMs);
    return laneState.result === 'success' && timingAvailable ? 'success' : laneState.result === 'unavailable' ? 'unavailable' : 'failure';
  }
  return laneState.result === 'success' ? 'success' : laneState.result === 'unavailable' ? 'unavailable' : 'failure';
}

export function shouldCloseFingerprint({ reports, fingerprint, occurrenceCount }) {
  const { category } = fingerprintParts(fingerprint);
  const required = category === 'performance' || occurrenceCount >= 2 ? 2 : 1;
  return reports.slice(0, required).length === required
    && reports.slice(0, required).every((report) => reportStateForFingerprint(report, fingerprint) === 'success');
}

function titleFor(occurrence) {
  const tags = { test: 'Test', performance: 'Performance', unit: 'Unit', build: 'Build', artifact: 'Artifact', infrastructure: 'Infrastructure', summary: 'Summary' };
  const detail = occurrence.testTitle || occurrence.specPath || occurrence.source || 'failure';
  return clean(`[CI][${tags[occurrence.category] ?? 'Failure'}][${occurrence.laneLabel ?? laneLabels[occurrence.lane] ?? occurrence.lane}] ${detail}`, 200);
}

function stateHistory(reports, fingerprint) {
  return reports.slice(0, MAX_HISTORY).map((report) => {
    const run = report.workflow ?? {};
    return `- Run \`${run.runId || 'unknown'}\`: \`${reportStateForFingerprint(report, fingerprint)}\` (${String(run.headSha ?? '').slice(0, 7) || 'unknown'})`;
  }).join('\n');
}

function autoCloseRule(category, count) {
  if (category === 'performance') return '같은 lane이 반복 이슈 기준 아래에서 2회 연속 성공하면 종료합니다.';
  if (count >= 2) return '같은 lane이 2회 연속 성공하면 종료합니다.';
  return '같은 lane이 다음 Main Branch QA에서 성공하면 종료합니다.';
}

function renderBody({ occurrence, metadata, report, reports }) {
  const run = report.workflow ?? {};
  const fingerprint = occurrence.fingerprint;
  const error = String(occurrence.normalizedError ?? 'No normalized error available').replaceAll('```', "'''").slice(0, 4_000);
  const body = [
    `${MARKER_PREFIX}${fingerprint} -->`,
    `<!-- qa-run-keys:${metadata.runKeys.join(',')} -->`,
    `<!-- qa-occurrences:${metadata.occurrenceCount} -->`,
    `<!-- qa-first-run:${metadata.firstRunId} -->`,
    'Main Branch QA 원인별 실패를 자동 추적합니다.', '',
    `- Category: \`${occurrence.category}\``,
    `- Fingerprint: \`${fingerprint}\``,
    `- Lane: \`${occurrence.laneLabel ?? laneLabels[occurrence.lane] ?? occurrence.lane}\``,
    `- Source: \`${occurrence.source}\``,
    `- Spec: ${occurrence.specPath ? `\`${occurrence.specPath}\`` : 'unavailable'}`,
    `- Test: ${occurrence.testTitle ? `\`${clean(occurrence.testTitle, 300)}\`` : 'unavailable'}`,
    `- First Run ID: \`${metadata.firstRunId}\``,
    `- Latest Run ID: \`${run.runId}\` (attempt ${run.runAttempt ?? 1})`,
    `- Latest Head SHA: [\`${run.headSha}\`](${run.runUrl ? run.runUrl.replace(/\/actions\/runs\/\d+$/u, `/commit/${run.headSha}`) : ''})`,
    `- Occurrences: \`${metadata.occurrenceCount}\``,
    `- Latest Run: ${run.runUrl ?? 'unavailable'}`, '',
    '### Normalized error', '', '```text', error, '```', '',
    '### Last states', '', stateHistory(reports, fingerprint) || '- unavailable', '',
    '### Auto-close rule', '', autoCloseRule(occurrence.category, metadata.occurrenceCount),
  ].join('\n');
  return body.slice(0, MAX_BODY);
}

function currentOccurrences(reports) {
  const current = reports[0] ?? {};
  const failures = [...(current.failures ?? [])];
  for (const candidate of current.performanceIssueCandidates ?? []) {
    if (failures.some((failure) => failure.category === 'performance' && failure.lane === candidate.laneCode)) continue;
    if (!qualifiesPerformanceIssue(reports, candidate.laneCode)) continue;
    const normalizedError = normalizeFailureText(`${candidate.laneLabel}: ${candidate.observedMs}ms > ${candidate.issueThresholdMs}ms`);
    failures.push({
      category: 'performance', lane: candidate.laneCode, laneLabel: candidate.laneLabel,
      source: 'duration-threshold', normalizedError, specPath: null, testTitle: null,
      fingerprint: candidate.fingerprint?.split('|').length === 4
        ? candidate.fingerprint
        : makeFailureFingerprint({ category: 'performance', lane: candidate.laneCode, source: 'duration-threshold', normalizedError }),
    });
  }
  return [...new Map(failures.map((failure) => [failure.fingerprint, failure])).values()];
}

async function api(pathname, options = {}) {
  const token = String(process.env.GITHUB_TOKEN ?? '');
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub API ${response.status}: ${text.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.arrayBuffer();
}

function zipEntry(zipPath, basename) {
  const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 2_000_000 })
    .split(/\r?\n/u).filter(Boolean);
  const entry = entries.find((name) => path.basename(name) === basename);
  return entry ? execFileSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8', maxBuffer: 5_000_000 }) : '';
}

function performanceOnlyReport(performance, run) {
  return {
    schemaVersion: 1,
    workflow: { runId: String(run.id), runAttempt: run.run_attempt ?? 1, runUrl: run.html_url, headSha: run.head_sha, branch: run.head_branch },
    summaryResult: run.conclusion === 'success' ? 'success' : 'failure',
    laneStates: (performance.lanes ?? []).map((lane) => ({
      code: lane.code, label: lane.label, result: 'unknown', durationMs: lane.durationMs,
      testDurationMs: lane.testDurationMs, issueThresholdMs: lane.issueThresholdMs,
    })),
    failures: [], primaryRootCause: null,
    performanceIssueCandidates: performance.performanceIssueCandidates ?? [],
  };
}

async function reportFromArtifact(run, owner, repo) {
  const artifacts = await api(`/repos/${owner}/${repo}/actions/runs/${run.id}/artifacts?name=qa-summary&per_page=10`);
  const artifact = artifacts.artifacts?.find((item) => item.name === 'qa-summary' && !item.expired);
  if (!artifact) return null;
  const buffer = Buffer.from(await api(`/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`));
  if (buffer.length > 25_000_000) throw new Error(`qa-summary artifact too large: ${buffer.length}`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-history-'));
  const zipPath = path.join(directory, 'artifact.zip');
  try {
    fs.writeFileSync(zipPath, buffer);
    const reportText = zipEntry(zipPath, 'qa-failure-report.json');
    if (reportText) return JSON.parse(reportText);
    const performanceText = zipEntry(zipPath, 'qa-performance.json');
    return performanceText ? performanceOnlyReport(JSON.parse(performanceText), run) : null;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function fallbackReport(runId, source) {
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY ?? '').split('/');
  const payload = await api(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  const laneStates = [];
  const failures = [];
  for (const job of payload.jobs ?? []) {
    const lane = job.name === 'Build and unit tests' ? 'build'
      : job.name === 'Summarize QA result' ? 'summary'
        : Object.entries(laneLabels).find(([, label]) => job.name === `QA ${label}`)?.[0];
    if (!lane) continue;
    laneStates.push({ code: lane, label: laneLabels[lane], result: job.conclusion ?? job.status });
    if (job.conclusion === 'success') continue;
    const failedStep = (job.steps ?? []).find((step) => step.conclusion === 'failure');
    if (lane === 'summary' && failures.length) continue;
    const category = lane === 'build' ? 'build' : failedStep?.name?.startsWith('Run ') ? 'test' : lane === 'summary' ? 'summary' : 'infrastructure';
    const normalizedError = normalizeFailureText(`${job.name}: ${failedStep?.name ?? job.conclusion ?? 'failed'}`);
    failures.push({
      category, lane, laneLabel: laneLabels[lane], source: failedStep?.name ?? 'job-result', normalizedError,
      specPath: null, testTitle: null,
      fingerprint: makeFailureFingerprint({ category, lane, source: failedStep?.name ?? 'job-result', normalizedError }),
    });
  }
  return {
    schemaVersion: 1,
    workflow: source,
    summaryResult: source.conclusion === 'success' && failures.length === 0 ? 'success' : 'failure',
    laneStates, failures, primaryRootCause: selectPrimaryRootCause(failures), performanceIssueCandidates: [],
  };
}

async function loadReports(current) {
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY ?? '').split('/');
  const workflowId = encodeURIComponent(String(process.env.SOURCE_WORKFLOW_ID ?? 'qa.yml'));
  const runs = await api(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?branch=main&status=completed&event=push&per_page=${MAX_HISTORY}`);
  const reports = [];
  for (const run of runs.workflow_runs ?? []) {
    if (String(run.id) === String(current.workflow?.runId)) {
      reports.push(current);
    } else {
      const report = await reportFromArtifact(run, owner, repo);
      if (report) reports.push(report);
    }
  }
  if (!reports.some((report) => String(report.workflow?.runId) === String(current.workflow?.runId))) reports.unshift(current);
  return reports.slice(0, MAX_HISTORY);
}

async function ensureLabel(owner, repo) {
  try {
    await api(`/repos/${owner}/${repo}/labels/${encodeURIComponent(LABEL)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await api(`/repos/${owner}/${repo}/labels`, { method: 'POST', body: JSON.stringify({ name: LABEL, color: 'B60205', description: 'Main Branch QA failure requiring investigation' }) });
  }
}

async function syncIssues(reports) {
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY ?? '').split('/');
  const current = reports[0];
  const occurrences = currentOccurrences(reports);
  const payload = await api(`/repos/${owner}/${repo}/issues?state=all&labels=${encodeURIComponent(LABEL)}&per_page=100`);
  const managed = (payload ?? []).filter((issue) => !issue.pull_request && isManagedIssue(issue.body));
  if (occurrences.length) await ensureLabel(owner, repo);

  const active = new Set();
  for (const occurrence of occurrences) {
    active.add(occurrence.fingerprint);
    const matching = managed.filter((issue) => parseIssueMetadata(issue.body).fingerprint === occurrence.fingerprint);
    const { canonical, duplicates } = chooseCanonicalIssue(matching);
    const runKey = `${current.workflow.runId}:${current.workflow.runAttempt ?? 1}`;
    const metadata = nextOccurrenceMetadata(canonical ? parseIssueMetadata(canonical.body) : { runKeys: [], occurrenceCount: 0, firstRunId: null }, runKey, current.workflow.runId);
    const body = renderBody({ occurrence, metadata, report: current, reports });
    if (canonical) {
      if (!metadata.alreadyProcessed) {
        await api(`/repos/${owner}/${repo}/issues/${canonical.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `새 동일 원인 Run 감지: ${current.workflow.runUrl} (\`${current.workflow.headSha}\`)\n<!-- qa-occurrence:${runKey} -->` }) });
      }
      await api(`/repos/${owner}/${repo}/issues/${canonical.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'open', title: titleFor(occurrence), body }) });
    } else {
      await api(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: titleFor(occurrence), body, labels: [LABEL] }) });
    }
    for (const duplicate of duplicates) {
      await api(`/repos/${owner}/${repo}/issues/${duplicate.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) });
    }
  }

  for (const issue of managed) {
    if (issue.state !== 'open') continue;
    const metadata = parseIssueMetadata(issue.body);
    if (!metadata.fingerprint || active.has(metadata.fingerprint)) continue;
    if (!shouldCloseFingerprint({ reports, fingerprint: metadata.fingerprint, occurrenceCount: metadata.occurrenceCount })) continue;
    await api(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `동일 lane의 해결 조건을 충족하여 자동 종료합니다.\n\n- Run: ${current.workflow.runUrl}\n- Head SHA: \`${current.workflow.headSha}\`` }) });
    await api(`/repos/${owner}/${repo}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
  }
  console.log(`QA failure issue sync: ${occurrences.length} active fingerprint(s), ${managed.length} managed issue(s)`);
}

async function main() {
  const requestedPath = process.argv[process.argv.indexOf('--sync') + 1];
  const source = {
    runId: String(process.env.SOURCE_RUN_ID ?? ''), runAttempt: Number(process.env.SOURCE_RUN_ATTEMPT ?? 1),
    runUrl: String(process.env.SOURCE_RUN_URL ?? ''), event: String(process.env.SOURCE_EVENT ?? ''),
    branch: String(process.env.SOURCE_BRANCH ?? ''), headSha: String(process.env.SOURCE_HEAD_SHA ?? ''),
    conclusion: String(process.env.SOURCE_CONCLUSION ?? ''), name: 'Main Branch QA',
  };
  let current = requestedPath && fs.existsSync(requestedPath) ? JSON.parse(fs.readFileSync(requestedPath, 'utf8')) : null;
  if (!current) current = await fallbackReport(source.runId, source);
  current.workflow = { ...source, ...(current.workflow ?? {}), conclusion: source.conclusion };
  const reports = await loadReports(current);
  await syncIssues(reports);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--sync')) {
  await main();
}
