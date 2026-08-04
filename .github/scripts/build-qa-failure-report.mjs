import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LANE_CONTRACTS = Object.freeze([
  { code: 'build', label: 'Build and unit', resultPath: null, testPath: null },
  { code: 'core', label: 'QA online core', resultPath: 'core/result.txt', testPath: 'core/qa-duration.json' },
  { code: 'seq', label: 'QA desktop sequence replay', resultPath: 'seq/result.txt', testPath: 'seq/qa-duration.json' },
  { code: 'desk', label: 'QA desktop regression', resultPath: 'desk/result.txt', testPath: 'desk/qa-duration.json' },
  { code: 'galaxy', label: 'QA mobile Galaxy', resultPath: 'galaxy/result.txt', testPath: 'galaxy/qa-duration.json' },
  { code: 'galtime', label: 'QA mobile Galaxy timing', resultPath: 'galtime/result.txt', testPath: 'galtime/qa-duration.json' },
  { code: 'galack', label: 'QA mobile Galaxy move ACK', resultPath: 'galack/result.txt', testPath: 'galack/qa-duration.json' },
  { code: 'galstart', label: 'QA mobile Galaxy move start', resultPath: 'galstart/result.txt', testPath: 'galstart/qa-duration.json' },
  { code: 'safvis', label: 'QA Safari visible mismatch', resultPath: 'safvis/result.txt', testPath: 'safvis/qa-duration.json' },
  { code: 'safari', label: 'QA Safari timing', resultPath: 'safari/result.txt', testPath: 'safari/qa-duration.json' },
]);

const FAILURE_PRIORITY = Object.freeze({ build: 1, unit: 1, test: 2, performance: 3, artifact: 4, infrastructure: 4, summary: 5 });
const MAX_ERROR_LENGTH = 1_200;

function readText(root, relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(root, relativePath) {
  const text = readText(root, relativePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sumDurations(report) {
  if (!report || !Array.isArray(report.durations) || report.durations.length === 0) return null;
  const durations = report.durations.map((entry) => Number(entry?.durationMs));
  return durations.every(Number.isFinite) ? durations.reduce((sum, value) => sum + value, 0) : null;
}

export function normalizeFailureText(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/https?:\/\/[^\s)]+/gu, '<url>')
    .replace(/\/home\/runner\/work\/[^\s:]+/gu, '<workspace>')
    .replace(/\/(?:tmp|var\/folders)\/[^\s:]+/gu, '<temp>')
    .replace(/\b[0-9a-f]{40}\b/giu, '<sha>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, '<uuid>')
    .replace(/\bdemo-yut-[a-z0-9-]+\b/giu, '<project>')
    .replace(/\b(?:room|qa-room)[-_:/][a-z0-9_-]+\b/giu, '<room>')
    .replace(/\b20\d\d-\d\d-\d\d[T ][0-9:.+-]+Z?\b/gu, '<timestamp>')
    .replace(/\b1[0-9]{9,12}\b/gu, '<epoch>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|msec|seconds?|secs?|s)\b/giu, '<duration>')
    .replace(/localhost:\d{4,5}/gu, 'localhost:<port>')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}

export function makeFailureFingerprint({ category, lane, source, normalizedError }) {
  const digest = crypto.createHash('sha256').update(normalizedError || 'unknown failure').digest('hex').slice(0, 12);
  return `${category}|${lane}|${source}|${digest}`;
}

function extractEvidence(text, fallback) {
  const clean = String(text ?? '').replace(/\u001b\[[0-9;]*m/gu, '');
  const lines = clean.split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
  const marker = /(AssertionError|TimeoutError|Error:|\bfailed\b|\bfailure\b|not ok|✘|×|expect\()/iu;
  let index = lines.findIndex((line) => marker.test(line));
  if (index < 0) index = Math.max(0, lines.length - 12);
  const excerpt = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 8)).join('\n') || fallback;
  const specPath = clean.match(/tests\/[A-Za-z0-9_./-]+\.spec\.[cm]?[jt]s/iu)?.[0] ?? null;
  const testTitle = lines.find((line) => /(?:›|\d+\)|\btest\b)/u.test(line) && marker.test(line))?.replace(/^.*?›\s*/u, '') ?? null;
  return { normalizedError: normalizeFailureText(excerpt || fallback), specPath, testTitle };
}

function findFirstLog(root, code, candidates) {
  for (const candidate of candidates) {
    const relativePath = code === 'build' ? candidate : `${code}/${candidate}`;
    const text = readText(root, relativePath);
    if (text) return { source: candidate, text };
  }
  const directory = path.join(root, code);
  if (code !== 'build' && fs.existsSync(directory)) {
    const generated = fs.readdirSync(directory).filter((name) => /(?:playwright|qa)-.*\.log$/u.test(name)).sort();
    if (generated.length) return { source: generated[0], text: readText(root, `${code}/${generated[0]}`) };
  }
  return { source: candidates[0], text: '' };
}

function createFailure({ category, lane, laneLabel, source, text, fallback }) {
  const evidence = extractEvidence(text, fallback);
  return {
    category,
    lane,
    laneLabel,
    source,
    ...evidence,
    fingerprint: makeFailureFingerprint({ category, lane, source, normalizedError: evidence.normalizedError }),
  };
}

function laneState(root, contract, env, performanceLane) {
  const jobTiming = readJson(root, `${contract.code}/qa-job-timing.json`) ?? (contract.code === 'build' ? readJson(root, 'build/qa-job-timing.json') : null);
  const testTiming = contract.testPath ? readJson(root, contract.testPath) : null;
  const result = contract.code === 'build'
    ? String(env.BUILD_RESULT ?? 'unavailable')
    : readText(root, contract.resultPath).trim() || 'unavailable';
  return {
    code: contract.code,
    label: contract.label,
    result,
    durationMs: Number.isFinite(Number(jobTiming?.durationMs)) ? Number(jobTiming.durationMs) : null,
    testDurationMs: contract.testPath ? sumDurations(testTiming) : null,
    targetMs: Number.isFinite(Number(performanceLane?.targetMs)) ? Number(performanceLane.targetMs) : null,
    issueThresholdMs: Number.isFinite(Number(performanceLane?.issueThresholdMs)) ? Number(performanceLane.issueThresholdMs) : null,
    emergencyLimitMs: Number.isFinite(Number(performanceLane?.emergencyLimitMs)) ? Number(performanceLane.emergencyLimitMs) : null,
  };
}

export function selectPrimaryRootCause(failures) {
  return [...failures].sort((left, right) => (FAILURE_PRIORITY[left.category] ?? 99) - (FAILURE_PRIORITY[right.category] ?? 99))[0] ?? null;
}

export function buildQaFailureReport({ root = process.cwd(), env = process.env } = {}) {
  const performance = readJson(root, 'qa-performance.json') ?? { failures: [], lanes: [], performanceIssueCandidates: [] };
  const performanceByCode = new Map((performance.lanes ?? []).map((lane) => [lane.code, lane]));
  const lanes = LANE_CONTRACTS.map((contract) => laneState(root, contract, env, performanceByCode.get(contract.code)));
  const failures = [];

  const buildState = lanes.find((lane) => lane.code === 'build');
  if (buildState?.result !== 'success') {
    const unit = findFirstLog(root, 'build', ['unit.log']);
    const build = findFirstLog(root, 'build', ['build.log']);
    const selected = /(?:not ok|AssertionError|\bfail(?:ed|ure)?\b)/iu.test(unit.text) ? unit : build.text ? build : unit;
    failures.push(createFailure({
      category: selected.source === 'unit.log' ? 'unit' : 'build',
      lane: 'build',
      laneLabel: buildState.label,
      source: selected.source,
      text: selected.text,
      fallback: `Build and unit result: ${buildState?.result ?? 'unavailable'}`,
    }));
  }

  for (const lane of lanes.filter(({ code }) => code !== 'build')) {
    if (lane.result === 'success') continue;
    if (lane.result === 'unavailable') {
      failures.push(createFailure({ category: 'artifact', lane: lane.code, laneLabel: lane.label, source: 'result.txt', text: '', fallback: `${lane.label}: result artifact unavailable` }));
      continue;
    }
    const log = findFirstLog(root, lane.code, ['qa-emulator-suite.log', 'playwright.log', 'qa-build.log', 'firebase-debug.log']);
    const category = /(?:AssertionError|TimeoutError|expect\(|tests\/.*\.spec\.|\bfailed\b)/iu.test(log.text) ? 'test' : 'infrastructure';
    failures.push(createFailure({ category, lane: lane.code, laneLabel: lane.label, source: log.source, text: log.text, fallback: `${lane.label} result: ${lane.result}` }));
  }

  for (const lane of performance.lanes ?? []) {
    if (lane.emergencyExceeded) {
      failures.push(createFailure({
        category: 'performance', lane: lane.code, laneLabel: lane.label, source: 'duration-threshold', text: '',
        fallback: `${lane.label}: ${lane.blockingDurationMs}ms > emergency ${lane.emergencyLimitMs}ms`,
      }));
    } else if (lane.blockingDurationMs === null || lane.durationMs === null) {
      failures.push(createFailure({
        category: 'artifact', lane: lane.code, laneLabel: lane.label, source: 'qa-performance.json', text: '',
        fallback: `${lane.label}: timing report unavailable`,
      }));
    }
  }

  if (String(env.PERFORMANCE_RESULT ?? 'success') !== 'success' && !failures.some(({ category }) => ['performance', 'artifact'].includes(category))) {
    failures.push(createFailure({ category: 'summary', lane: 'summary', laneLabel: 'Summarize QA result', source: 'qa-performance.json', text: (performance.failures ?? []).join('\n'), fallback: 'QA performance validation failed' }));
  }
  if (String(env.EMULATOR_RESULT ?? 'success') !== 'success' && !failures.some(({ lane }) => lane !== 'build' && lane !== 'summary')) {
    failures.push(createFailure({ category: 'summary', lane: 'summary', laneLabel: 'Summarize QA result', source: 'matrix-result', text: '', fallback: `Firebase emulator matrix result: ${env.EMULATOR_RESULT}` }));
  }

  const deduplicated = [...new Map(failures.map((failure) => [failure.fingerprint, failure])).values()];
  const summaryResult = deduplicated.length === 0
    && String(env.BUILD_RESULT ?? '') === 'success'
    && String(env.EMULATOR_RESULT ?? '') === 'success'
    && String(env.PERFORMANCE_RESULT ?? '') === 'success' ? 'success' : 'failure';

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    workflow: {
      name: String(env.WORKFLOW_NAME ?? env.GITHUB_WORKFLOW ?? 'Main Branch QA'),
      runId: String(env.GITHUB_RUN_ID ?? ''),
      runAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1),
      runUrl: `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY ?? ''}/actions/runs/${env.GITHUB_RUN_ID ?? ''}`,
      event: String(env.GITHUB_EVENT_NAME ?? 'push'),
      branch: String(env.HEAD_BRANCH ?? env.GITHUB_REF_NAME ?? ''),
      headSha: String(env.HEAD_SHA ?? env.GITHUB_SHA ?? ''),
    },
    summaryResult,
    laneStates: lanes,
    failures: deduplicated,
    primaryRootCause: selectPrimaryRootCause(deduplicated),
    performanceIssueCandidates: Array.isArray(performance.performanceIssueCandidates) ? performance.performanceIssueCandidates : [],
  };
}

function main() {
  const report = buildQaFailureReport();
  fs.writeFileSync('qa-failure-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(`QA failure report: ${report.failures.length} failure(s), ${report.performanceIssueCandidates.length} performance candidate(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
