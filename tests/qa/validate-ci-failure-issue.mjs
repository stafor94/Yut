import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildQaFailureReport,
  makeFailureFingerprint,
  normalizeFailureText,
  selectPrimaryRootCause,
} from '../../.github/scripts/build-qa-failure-report.mjs';
import {
  chooseCanonicalIssue,
  isManagedIssue,
  nextOccurrenceMetadata,
  parseIssueMetadata,
  qualifiesPerformanceIssue,
  shouldCloseFingerprint,
} from '../../.github/scripts/qa-failure-fingerprint.mjs';

const root = process.cwd();
const qaWorkflow = fs.readFileSync(path.join(root, '.github/workflows/qa.yml'), 'utf8');
const issueWorkflow = fs.readFileSync(path.join(root, '.github/workflows/ci-failure-issue.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const dynamicA = 'TimeoutError at 2026-08-05T01:02:03.000Z room:room-abc demo-yut-1234 took 301.2s sha 0123456789012345678901234567890123456789';
const dynamicB = 'TimeoutError at 2026-08-06T05:06:07.000Z room:room-xyz demo-yut-9999 took 305.8s sha abcdefabcdefabcdefabcdefabcdefabcdefabcd';
assert.equal(normalizeFailureText(dynamicA), normalizeFailureText(dynamicB), '동적 timestamp, room, project, duration, SHA는 fingerprint에서 제거되어야 합니다.');

const normalized = normalizeFailureText(dynamicA);
const sameA = makeFailureFingerprint({ category: 'test', lane: 'galtime', source: 'qa-emulator-suite.log', normalizedError: normalized });
const sameB = makeFailureFingerprint({ category: 'test', lane: 'galtime', source: 'qa-emulator-suite.log', normalizedError: normalizeFailureText(dynamicB) });
assert.equal(sameA, sameB, '동일 오류의 동적 값 차이는 같은 fingerprint여야 합니다.');
assert.notEqual(sameA, makeFailureFingerprint({ category: 'test', lane: 'galack', source: 'qa-emulator-suite.log', normalizedError: normalized }), '다른 lane은 다른 fingerprint여야 합니다.');
assert.notEqual(sameA, makeFailureFingerprint({ category: 'performance', lane: 'galtime', source: 'duration-threshold', normalizedError: normalized }), '테스트 실패와 성능 실패는 분리되어야 합니다.');

const primary = selectPrimaryRootCause([
  { category: 'summary', fingerprint: 'summary' },
  { category: 'test', fingerprint: 'test' },
  { category: 'performance', fingerprint: 'performance' },
]);
assert.equal(primary.fingerprint, 'test', 'underlying test failure가 summary aggregator보다 우선해야 합니다.');

const performanceReport = (runId, breached, lane = 'galtime') => ({
  workflow: { runId: String(runId), runAttempt: 1, headSha: `sha-${runId}` },
  summaryResult: 'success',
  laneStates: [{ code: lane, result: 'success', durationMs: 200_000, testDurationMs: 200_000 }],
  failures: [],
  performanceIssueCandidates: breached ? [{ laneCode: lane, laneLabel: lane, observedMs: 310_000, issueThresholdMs: 300_000, blocking: false }] : [],
});
assert.equal(qualifiesPerformanceIssue([performanceReport(1, true)], 'galtime'), false, '단일 성능 초과는 이슈를 만들지 않아야 합니다.');
assert.equal(qualifiesPerformanceIssue([performanceReport(2, true), performanceReport(1, true)], 'galtime'), true, '2회 연속 성능 초과는 이슈 대상이어야 합니다.');
assert.equal(qualifiesPerformanceIssue([
  performanceReport(5, true), performanceReport(4, false), performanceReport(3, true), performanceReport(2, false), performanceReport(1, true),
], 'galtime'), true, '최근 5회 중 3회 성능 초과는 이슈 대상이어야 합니다.');

const performanceFingerprint = 'performance|galtime|duration-threshold|abc123';
assert.equal(shouldCloseFingerprint({ reports: [performanceReport(7, false), performanceReport(6, false)], fingerprint: performanceFingerprint, occurrenceCount: 1 }), true, '성능 이슈는 2회 연속 정상일 때 닫혀야 합니다.');
const testFingerprint = 'test|galtime|qa-emulator-suite.log|abc123';
assert.equal(shouldCloseFingerprint({
  reports: [{ laneStates: [{ code: 'galack', result: 'success' }] }], fingerprint: testFingerprint, occurrenceCount: 1,
}), false, '다른 lane 성공은 이슈를 닫지 않아야 합니다.');

const metadata = nextOccurrenceMetadata({ runKeys: ['10:1'], occurrenceCount: 1, firstRunId: '10' }, '10:1', '10');
assert.equal(metadata.alreadyProcessed, true, '같은 run/attempt는 idempotent해야 합니다.');
assert.equal(metadata.occurrenceCount, 1, '같은 run/attempt 재처리 시 발생 횟수가 늘면 안 됩니다.');
const duplicateChoice = chooseCanonicalIssue([{ number: 12 }, { number: 9 }, { number: 15 }]);
assert.equal(duplicateChoice.canonical.number, 9, '중복 fingerprint 이슈는 가장 오래된 번호를 유지해야 합니다.');
assert.deepEqual(duplicateChoice.duplicates.map(({ number }) => number), [12, 15]);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-report-test-'));
try {
  fs.mkdirSync(path.join(temp, 'build'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'build/qa-job-timing.json'), JSON.stringify({ durationMs: 10_000 }));
  for (const code of ['core', 'seq', 'desk', 'galaxy', 'galtime', 'galack', 'galstart', 'safvis', 'safari']) {
    fs.mkdirSync(path.join(temp, code), { recursive: true });
    fs.writeFileSync(path.join(temp, code, 'result.txt'), code === 'galtime' ? '' : 'success\n');
    fs.writeFileSync(path.join(temp, code, 'qa-job-timing.json'), JSON.stringify({ durationMs: 10_000 }));
    fs.writeFileSync(path.join(temp, code, 'qa-duration.json'), JSON.stringify({ durations: [{ durationMs: 9_000 }] }));
  }
  fs.writeFileSync(path.join(temp, 'qa-performance.json'), JSON.stringify({ lanes: [], failures: [], performanceIssueCandidates: [] }));
  const report = buildQaFailureReport({ root: temp, env: { BUILD_RESULT: 'success', EMULATOR_RESULT: 'failure', PERFORMANCE_RESULT: 'success' } });
  const artifactFailure = report.failures.find(({ category, lane }) => category === 'artifact' && lane === 'galtime');
  assert.ok(artifactFailure, 'lane result artifact 누락은 artifact fingerprint로 분류되어야 합니다.');
  assert.match(artifactFailure.fingerprint, /^artifact\|galtime\|result\.txt\|/u);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const managedBody = '<!-- qa-fingerprint:v1:test|galtime|source|hash -->\n<!-- qa-run-keys:1:1 -->\n<!-- qa-occurrences:1 -->';
assert.equal(isManagedIssue(managedBody), true);
assert.equal(parseIssueMetadata(managedBody).fingerprint, 'test|galtime|source|hash');
assert.equal(isManagedIssue('<!-- ci-failure:main-branch-qa -->'), false, 'legacy aggregate marker는 새 fingerprint 자동화와 격리되어야 합니다.');

assert.match(qaWorkflow, /name: Build QA failure report/u);
assert.match(qaWorkflow, /node \.github\/scripts\/build-qa-failure-report\.mjs/u);
assert.match(qaWorkflow, /qa-failure-report\.json/u);
assert.match(qaWorkflow, /FAILURE_REPORT_RESULT: \$\{\{ steps\.failure-report\.outcome \}\}/u);
assert.match(qaWorkflow, /test "\$FAILURE_REPORT_RESULT" = success/u);
assert.match(issueWorkflow, /workflow_run:/u);
assert.match(issueWorkflow, /github\.event\.workflow_run\.event == 'push'/u);
assert.match(issueWorkflow, /github\.event\.workflow_run\.head_branch == 'main'/u);
assert.match(issueWorkflow, /ref: main/u, 'workflow_run은 현재 default main의 script를 checkout해야 합니다.');
assert.match(issueWorkflow, /contents: read\n  actions: read\n  issues: write/u, '최소 workflow 권한을 유지해야 합니다.');
assert.match(issueWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/u);
assert.match(issueWorkflow, /qa-failure-fingerprint\.mjs --sync/u);
assert.doesNotMatch(issueWorkflow, /actions\/github-script/u, 'artifact 문자열을 inline JavaScript로 실행하지 않아야 합니다.');
assert.match(packageJson.scripts['qa:validate-architecture'], /validate-ci-failure-issue\.mjs/u);

console.log('CI failure issue validation passed');
