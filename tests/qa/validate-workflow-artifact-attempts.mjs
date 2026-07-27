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
  'name: build-and-unit\n          overwrite: true',
  'build artifact가 같은 이름의 이전 attempt를 교체하도록 설정되지 않았습니다.',
);
requireQa(
  'name: qa-${{ matrix.code }}-results\n          overwrite: true',
  'QA shard artifact가 같은 lane의 이전 attempt를 교체하도록 설정되지 않았습니다.',
);
requireQa(
  'name: qa-summary\n          overwrite: true',
  'QA summary artifact가 이전 attempt summary를 교체하도록 설정되지 않았습니다.',
);
requireQa(
  'name: build-and-unit\n        continue-on-error: true',
  'summary가 검증된 build artifact를 이름으로 직접 다운로드하지 않습니다.',
);
requireQa(
  "pattern: 'qa-*-results'",
  'summary가 QA shard artifact만 다운로드하도록 제한되지 않았습니다.',
);
requireDeploy(
  'name: build-and-unit\n          path: build-and-unit',
  'Pages 배포가 overwrite된 검증 build artifact를 다운로드하지 않습니다.',
);

if (/pattern:\s*'\*'\s*$/mu.test(qaWorkflow)) {
  failures.push('summary가 QA summary를 포함한 모든 artifact를 다시 합치는 광역 pattern을 사용하고 있습니다.');
}
if (/name:\s*(?:build-and-unit|qa-\$\{\{ matrix\.code \}\}-results|qa-summary)-\$\{\{ github\.run_attempt \}\}/u.test(qaWorkflow)) {
  failures.push('부분 job 재실행에서 다른 lane을 누락시키는 run_attempt suffix artifact 이름이 남아 있습니다.');
}
if (/pattern:\s*'[^']*qa-summary[^']*'/u.test(qaWorkflow)) {
  failures.push('summary 다운로드 pattern에 이전 QA summary artifact가 포함될 수 있습니다.');
}

if (failures.length > 0) {
  console.error(`QA workflow rerun artifact validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('QA workflow rerun artifact validation passed');
