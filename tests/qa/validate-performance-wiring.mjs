import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qa.yml'), 'utf8');
const performanceScript = fs.readFileSync(path.join(root, '.github/scripts/validate-qa-performance.mjs'), 'utf8');

const targetBlock = performanceScript.match(/QA_PERFORMANCE_TARGETS_MS = Object\.freeze\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? '';
const issueThresholdBlock = performanceScript.match(/QA_PERFORMANCE_ISSUE_THRESHOLDS_MS = Object\.freeze\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? '';
const emergencyLimitBlock = performanceScript.match(/QA_PERFORMANCE_EMERGENCY_LIMITS_MS = Object\.freeze\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? '';

function readDuration(block, code) {
  const rawValue = block.match(new RegExp(`\\n  ${code}: ([1-9][0-9_]*),`, 'u'))?.[1] ?? '';
  return Number(rawValue.replaceAll('_', ''));
}

assert.match(targetBlock, /overall: 300_000/u, '전체 Main Branch QA 관찰 목표는 5분이어야 합니다.');
assert.match(targetBlock, /summaryReserve: [1-9][0-9_]*/u, 'summary job 완료 여유 시간이 필요합니다.');
assert.equal(readDuration(emergencyLimitBlock, 'overall'), 370_000, 'Galaxy 비상 한계 360초와 summary 여유 10초를 함께 수용해야 합니다.');

const allLaneCodes = ['build', 'core', 'seq', 'desk', 'galaxy', 'galtime', 'galack', 'galstart', 'safvis', 'safari'];
for (const code of allLaneCodes) {
  assert.ok(Number.isFinite(readDuration(targetBlock, code)), `${code} lane 관찰 목표가 필요합니다.`);
  assert.ok(Number.isFinite(readDuration(emergencyLimitBlock, code)), `${code} lane 비상 차단 한계가 필요합니다.`);
  assert.ok(readDuration(emergencyLimitBlock, code) > readDuration(targetBlock, code), `${code} lane 비상 차단 한계는 관찰 목표보다 커야 합니다.`);
  assert.match(performanceScript, new RegExp(`code: '${code}'`, 'u'), `${code} lane이 성능 보고서에 등록되어야 합니다.`);
}

for (const code of ['galtime', 'galack', 'galstart']) {
  assert.ok(Number.isFinite(readDuration(issueThresholdBlock, code)), `${code} lane 반복 이슈 기준이 필요합니다.`);
  assert.ok(readDuration(issueThresholdBlock, code) > readDuration(targetBlock, code), `${code} 반복 이슈 기준은 관찰 목표보다 커야 합니다.`);
  assert.ok(readDuration(emergencyLimitBlock, code) > readDuration(issueThresholdBlock, code), `${code} 비상 차단 한계는 반복 이슈 기준보다 커야 합니다.`);
  assert.equal(readDuration(emergencyLimitBlock, code), 360_000, `${code} 비상 차단 한계는 360초여야 합니다.`);
}

assert.match(performanceScript, /const warnings = \[\]/u, '목표 초과를 차단 실패와 구분하는 경고 목록이 필요합니다.');
assert.match(performanceScript, /const performanceIssueCandidates = \[\]/u, '반복 성능 이슈 후보 목록이 필요합니다.');
assert.match(performanceScript, /issueEligible/u, '반복 이슈 기준 초과 여부를 구조화해야 합니다.');
assert.match(performanceScript, /performance\|\$\{contract\.code\}\|duration-threshold/u, '성능 후보 fingerprint가 안정적으로 생성되어야 합니다.');
assert.match(performanceScript, /passed: failures\.length === 0/u, '경고와 반복 후보만으로 workflow를 실패시키지 않아야 합니다.');
assert.match(performanceScript, /360_001/u, '360초 초과 비상 차단 self-test가 필요합니다.');
assert.match(performanceScript, /360_000/u, '360초 경계 성공 self-test가 필요합니다.');
assert.match(performanceScript, /285_001/u, '기존 285초 단발 초과가 더 이상 차단되지 않는 self-test가 필요합니다.');
assert.match(performanceScript, /300_001/u, 'Galaxy timing 반복 후보 self-test가 필요합니다.');
assert.match(performanceScript, /비상 차단 한계/u, '성능 보고서가 반복 기준과 비상 차단 한계를 구분해야 합니다.');

assert.match(workflow, /permissions:\n\s+actions: read\n/u, 'workflow run 시작 시각 조회를 위한 actions: read 권한이 필요합니다.');
assert.match(workflow, /Record build and unit timing/u, 'Build/unit 전체 job 시간이 기록되어야 합니다.');
assert.match(workflow, /qa-job-timing\.json/u, '각 QA lane 전체 job 시간 artifact가 필요합니다.');
assert.match(workflow, /id: performance\n\s+name: Validate QA performance budget/u, 'summary job이 성능 검증을 실행해야 합니다.');
assert.match(workflow, /run: node \.github\/scripts\/validate-qa-performance\.mjs/u, 'summary job이 공통 성능 검증 스크립트를 사용해야 합니다.');
assert.match(workflow, /PERFORMANCE_RESULT: \$\{\{ steps\.performance\.outcome \}\}/u, '성능 검증 결과가 필수 stage 실패 조건에 연결되어야 합니다.');
assert.match(workflow, /test "\$PERFORMANCE_RESULT" = success/u, '비상 차단 한계 초과 시 workflow가 실패해야 합니다.');
assert.match(workflow, /qa-performance\.json/u, '성능 검증 JSON artifact가 보존되어야 합니다.');
assert.match(workflow, /qa-performance\.md/u, '성능 검증 Markdown summary가 보존되어야 합니다.');

const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4', workflow.indexOf('summarize-qa-result:'));
const performanceIndex = workflow.indexOf('name: Validate QA performance budget');
assert.ok(checkoutIndex >= 0 && checkoutIndex < performanceIndex, 'summary job은 성능 스크립트 실행 전에 저장소를 checkout해야 합니다.');

console.log('QA performance wiring validation passed');
