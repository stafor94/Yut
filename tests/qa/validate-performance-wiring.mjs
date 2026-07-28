import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qa.yml'), 'utf8');
const performanceScript = fs.readFileSync(path.join(root, '.github/scripts/validate-qa-performance.mjs'), 'utf8');

const targetBlock = performanceScript.match(/QA_PERFORMANCE_TARGETS_MS = Object\.freeze\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? '';
const hardLimitBlock = performanceScript.match(/QA_PERFORMANCE_HARD_LIMITS_MS = Object\.freeze\(\{([\s\S]*?)\n\}\);/u)?.[1] ?? '';

assert.match(targetBlock, /overall: 300_000/u, '전체 Main Branch QA 관찰 목표는 5분이어야 합니다.');
assert.match(targetBlock, /summaryReserve: [1-9][0-9_]*/u, 'summary job 완료 여유 시간이 필요합니다.');
assert.match(hardLimitBlock, /overall: [3-9][0-9][0-9]_000/u, 'runner 편차와 실제 회귀를 구분할 전체 차단 한계가 필요합니다.');
for (const code of ['build', 'core', 'seq', 'desk', 'galaxy', 'galtime', 'safvis', 'safari']) {
  assert.match(targetBlock, new RegExp(`\n  ${code}: [1-9][0-9_]*,`, 'u'), `${code} lane 관찰 목표가 필요합니다.`);
  assert.match(hardLimitBlock, new RegExp(`\n  ${code}: [1-9][0-9_]*,`, 'u'), `${code} lane 차단 한계가 필요합니다.`);
  assert.match(performanceScript, new RegExp(`code: '${code}'`, 'u'), `${code} lane이 성능 보고서에 등록되어야 합니다.`);
}

assert.match(performanceScript, /const warnings = \[\]/u, '목표 초과를 차단 실패와 구분하는 경고 목록이 필요합니다.');
assert.match(performanceScript, /status === 'warning'/u, '목표 초과는 warning으로 분류되어야 합니다.');
assert.match(performanceScript, /status === 'failure'/u, '차단 한계 초과는 failure로 분류되어야 합니다.');
assert.match(performanceScript, /passed: failures\.length === 0/u, '경고만으로 workflow를 실패시키지 않아야 합니다.');
assert.match(performanceScript, /차단 한계/u, '성능 보고서가 관찰 목표와 차단 한계를 구분해야 합니다.');

assert.match(workflow, /permissions:\n\s+actions: read\n/u, 'workflow run 시작 시각 조회를 위한 actions: read 권한이 필요합니다.');
assert.match(workflow, /Record build and unit timing/u, 'Build/unit 전체 job 시간이 기록되어야 합니다.');
assert.match(workflow, /qa-job-timing\.json/u, '각 QA lane 전체 job 시간 artifact가 필요합니다.');
assert.match(workflow, /id: performance\n\s+name: Validate QA performance budget/u, 'summary job이 성능 검증을 실행해야 합니다.');
assert.match(workflow, /run: node \.github\/scripts\/validate-qa-performance\.mjs/u, 'summary job이 공통 성능 검증 스크립트를 사용해야 합니다.');
assert.match(workflow, /PERFORMANCE_RESULT: \$\{\{ steps\.performance\.outcome \}\}/u, '성능 검증 결과가 필수 stage 실패 조건에 연결되어야 합니다.');
assert.match(workflow, /test "\$PERFORMANCE_RESULT" = success/u, '성능 차단 한계 초과 시 workflow가 실패해야 합니다.');
assert.match(workflow, /qa-performance\.json/u, '성능 검증 JSON artifact가 보존되어야 합니다.');
assert.match(workflow, /qa-performance\.md/u, '성능 검증 Markdown summary가 보존되어야 합니다.');

const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4', workflow.indexOf('summarize-qa-result:'));
const performanceIndex = workflow.indexOf('name: Validate QA performance budget');
assert.ok(checkoutIndex >= 0 && checkoutIndex < performanceIndex, 'summary job은 성능 스크립트 실행 전에 저장소를 checkout해야 합니다.');

console.log('QA performance wiring validation passed');
