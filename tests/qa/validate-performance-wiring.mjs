import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, '.github/workflows/qa.yml'), 'utf8');
const performanceScript = fs.readFileSync(path.join(root, '.github/scripts/validate-qa-performance.mjs'), 'utf8');

assert.match(performanceScript, /overall: 300_000/u, '전체 Main Branch QA 성능 목표는 5분이어야 합니다.');
assert.match(performanceScript, /summaryReserve: [1-9][0-9_]*/u, 'summary job 완료 여유 시간이 필요합니다.');
for (const code of ['build', 'core', 'seq', 'desk', 'galaxy', 'galtime', 'safvis', 'safari']) {
  assert.match(performanceScript, new RegExp(`\n  ${code}: [1-9][0-9_]*,`, 'u'), `${code} lane 성능 예산이 필요합니다.`);
  assert.match(performanceScript, new RegExp(`code: '${code}'`, 'u'), `${code} lane이 성능 보고서에 등록되어야 합니다.`);
}

assert.match(workflow, /permissions:\n\s+actions: read\n/u, 'workflow run 시작 시각 조회를 위한 actions: read 권한이 필요합니다.');
assert.match(workflow, /Record build and unit timing/u, 'Build/unit 전체 job 시간이 기록되어야 합니다.');
assert.match(workflow, /qa-job-timing\.json/u, '각 QA lane 전체 job 시간 artifact가 필요합니다.');
assert.match(workflow, /id: performance\n\s+name: Validate QA performance budget/u, 'summary job이 성능 예산 검증을 실행해야 합니다.');
assert.match(workflow, /run: node \.github\/scripts\/validate-qa-performance\.mjs/u, 'summary job이 공통 성능 검증 스크립트를 사용해야 합니다.');
assert.match(workflow, /PERFORMANCE_RESULT: \$\{\{ steps\.performance\.outcome \}\}/u, '성능 검증 결과가 필수 stage 실패 조건에 연결되어야 합니다.');
assert.match(workflow, /test "\$PERFORMANCE_RESULT" = success/u, '성능 예산 초과 시 workflow가 실패해야 합니다.');
assert.match(workflow, /qa-performance\.json/u, '성능 검증 JSON artifact가 보존되어야 합니다.');
assert.match(workflow, /qa-performance\.md/u, '성능 검증 Markdown summary가 보존되어야 합니다.');

const checkoutIndex = workflow.indexOf('- uses: actions/checkout@v4', workflow.indexOf('summarize-qa-result:'));
const performanceIndex = workflow.indexOf('name: Validate QA performance budget');
assert.ok(checkoutIndex >= 0 && checkoutIndex < performanceIndex, 'summary job은 성능 스크립트 실행 전에 저장소를 checkout해야 합니다.');

console.log('QA performance wiring validation passed');
