import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const qaWorkflow = fs.readFileSync(path.join(root, '.github/workflows/qa.yml'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
const failures = [];

const requireQa = (fragment, message) => {
  if (!qaWorkflow.includes(fragment)) failures.push(message);
};
const requireDeploy = (fragment, message) => {
  if (!deployWorkflow.includes(fragment)) failures.push(message);
};

requireQa(
  'name: build-and-unit-${{ github.run_attempt }}',
  'build artifact 이름에 github.run_attempt가 없어 재실행 artifact와 충돌할 수 있습니다.',
);
requireQa(
  'name: qa-${{ matrix.code }}-results-${{ github.run_attempt }}',
  'QA shard artifact 이름에 github.run_attempt가 없어 재실행 artifact와 충돌할 수 있습니다.',
);
requireQa(
  "pattern: '*-${{ github.run_attempt }}'",
  'summary가 현재 run_attempt artifact만 다운로드하도록 제한되지 않았습니다.',
);
requireQa(
  'name: qa-summary-${{ github.run_attempt }}',
  'summary artifact 이름에 github.run_attempt가 없어 재실행 summary와 충돌할 수 있습니다.',
);
requireDeploy(
  'name: build-and-unit-${{ github.event.workflow_run.run_attempt }}',
  'Pages 배포가 성공한 workflow attempt의 build artifact를 선택하지 않습니다.',
);

if (/pattern:\s*'\*'\s*$/mu.test(qaWorkflow)) {
  failures.push('summary가 모든 attempt artifact를 합치는 광역 pattern을 사용하고 있습니다.');
}
if (/name:\s*build-and-unit\s*$/mu.test(qaWorkflow)) {
  failures.push('attempt가 없는 legacy build artifact 이름이 남아 있습니다.');
}
if (/name:\s*qa-\$\{\{ matrix\.code \}\}-results\s*$/mu.test(qaWorkflow)) {
  failures.push('attempt가 없는 legacy QA shard artifact 이름이 남아 있습니다.');
}

if (failures.length > 0) {
  console.error(`QA workflow artifact attempt validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('QA workflow artifact attempt validation passed');
