import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const prWorkflow = read('.github/workflows/pr-required-qa.yml');
const mainWorkflow = read('.github/workflows/qa.yml');
const deployWorkflow = read('.github/workflows/deploy-pages.yml');

const requireText = (source, text, message) => {
  if (!source.includes(text)) fail(message);
};

const getJobBlock = (source, jobId) => {
  const marker = `\n  ${jobId}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const remainder = source.slice(start + marker.length);
  const nextJob = remainder.search(/^  [a-z0-9-]+:\s*$/mu);
  return nextJob < 0 ? remainder : remainder.slice(0, nextJob);
};

requireText(prWorkflow, 'name: PR Required QA', 'PR workflow 이름은 PR Required QA여야 합니다.');
requireText(prWorkflow, 'pull_request:', 'PR Required QA가 pull_request에서 실행되지 않습니다.');
requireText(prWorkflow, 'branches: [main]', 'PR Required QA가 main 대상 pull_request로 제한되지 않았습니다.');
for (const eventType of ['opened', 'synchronize', 'reopened', 'ready_for_review']) {
  requireText(prWorkflow, eventType, `PR Required QA pull_request type이 없습니다: ${eventType}`);
}
requireText(prWorkflow, 'workflow_dispatch:', 'PR Required QA에 workflow_dispatch가 없습니다.');
if (prWorkflow.includes('pull_request_target:')) fail('PR Required QA에서 pull_request_target을 사용하면 안 됩니다.');
if (/^\s+(?:paths|paths-ignore):/mu.test(prWorkflow)) fail('PR Required QA는 변경 경로에 따라 생략하면 안 됩니다.');

const permissionsBlock = prWorkflow.match(/\npermissions:\n([\s\S]*?)\nconcurrency:/u)?.[1] ?? '';
if (!/^\s{2}contents:\s*read\s*$/mu.test(permissionsBlock)) fail('PR Required QA는 contents: read 최소 권한을 명시해야 합니다.');
if (/write-all|:\s*write\s*$/mu.test(permissionsBlock)) fail('PR Required QA에 write 권한을 부여하면 안 됩니다.');
requireText(prWorkflow, 'group: pr-required-qa-${{ github.event.pull_request.number || github.ref_name || github.ref }}', 'PR 번호 기준 concurrency가 없습니다.');
requireText(prWorkflow, 'cancel-in-progress: true', '새 PR commit에서 이전 실행을 취소해야 합니다.');

const buildJob = getJobBlock(prWorkflow, 'build-and-unit');
if (!buildJob) fail('Build and unit job이 없습니다.');
for (const contract of [
  ['name: Build and unit', 'Build and unit job 이름이 다릅니다.'],
  ['node-version: 22', 'Build and unit이 Node 22를 사용하지 않습니다.'],
  ['npm ci', 'Build and unit이 npm ci를 실행하지 않습니다.'],
  ['npm run qa:validate-architecture', 'Build and unit이 architecture validator를 실행하지 않습니다.'],
  ['node .github/scripts/write-firebase-env.mjs', 'Build and unit이 기존 Firebase 환경을 준비하지 않습니다.'],
  ['npm run build', 'Build and unit이 build를 실행하지 않습니다.'],
  ['npm run test:unit', 'Build and unit이 unit tests를 실행하지 않습니다.'],
  ['if: always()', 'Build and unit이 실패 artifact를 항상 저장하지 않습니다.'],
  ['test-results/qa-architecture-report.json', 'Build and unit artifact에 architecture report가 없습니다.'],
]) requireText(buildJob, contract[0], contract[1]);

const emulatorJob = getJobBlock(prWorkflow, 'firebase-emulator-qa');
if (!emulatorJob) fail('Firebase emulator QA matrix job이 없습니다.');
for (const group of ['online-core', 'mobile-galaxy', 'mobile-galaxy-timing']) {
  requireText(emulatorJob, `- group: ${group}`, `PR emulator matrix에 필수 group이 없습니다: ${group}`);
}
for (const contract of [
  ['node-version: 22', 'PR emulator matrix가 Node 22를 사용하지 않습니다.'],
  ['npm ci', 'PR emulator matrix가 npm ci를 실행하지 않습니다.'],
  ['npx playwright install --with-deps chromium', 'PR emulator matrix가 Chromium을 설치하지 않습니다.'],
  ['node .github/scripts/write-qa-firebase-env.mjs', 'PR emulator matrix가 격리 Firebase 환경을 준비하지 않습니다.'],
  ['node .github/scripts/verify-qa-emulator-config.mjs', 'PR emulator matrix가 production Firebase 설정을 차단하지 않습니다.'],
  ['npm run build:qa', 'PR emulator matrix가 QA build를 실행하지 않습니다.'],
  ['--only auth,firestore', 'PR emulator matrix가 Auth와 Firestore emulator를 함께 사용하지 않습니다.'],
  ['npm run qa:emulator-suite -- --group ${{ matrix.group }}', 'PR emulator matrix가 각 실제 group을 실행하지 않습니다.'],
  ['if: always()', 'PR emulator matrix가 실패 artifact를 항상 저장하지 않습니다.'],
  ['test-results', 'PR emulator artifact에 Playwright test-results가 없습니다.'],
]) requireText(emulatorJob, contract[0], contract[1]);
if (!emulatorJob.includes('QA_PROJECT_ID: demo-yut-pr-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.code }}')) {
  fail('PR emulator matrix가 run/attempt/shard별 격리 project ID를 사용하지 않습니다.');
}

const gateJob = getJobBlock(prWorkflow, 'required-pr-gate');
if (!gateJob) fail('Required PR gate job이 없습니다.');
for (const contract of [
  ['name: Required PR gate', 'Required PR gate의 check 이름이 다릅니다.'],
  ['if: always()', 'Required PR gate는 if: always()로 실행되어야 합니다.'],
  ['needs: [build-and-unit, firebase-emulator-qa]', 'Required PR gate가 build/unit과 emulator matrix 전체를 의존하지 않습니다.'],
  ['${{ needs.build-and-unit.result }}', 'Required PR gate가 build/unit 결과를 확인하지 않습니다.'],
  ['${{ needs.firebase-emulator-qa.result }}', 'Required PR gate가 emulator matrix 결과를 확인하지 않습니다.'],
  ['test "$BUILD_AND_UNIT_RESULT" = success', 'Required PR gate가 build/unit의 success만 허용하지 않습니다.'],
  ['test "$FIREBASE_EMULATOR_QA_RESULT" = success', 'Required PR gate가 emulator matrix의 success만 허용하지 않습니다.'],
]) requireText(gateJob, contract[0], contract[1]);

for (const [jobId, block] of [['build-and-unit', buildJob], ['firebase-emulator-qa', emulatorJob], ['required-pr-gate', gateJob]]) {
  if (block.includes('continue-on-error')) fail(`필수 PR QA job에 continue-on-error가 있습니다: ${jobId}`);
}

requireText(mainWorkflow, 'name: Main Branch QA', '기존 Main Branch QA workflow 이름이 변경됐습니다.');
requireText(mainWorkflow, 'branches: [main, firebase-smooth-integration]', '기존 Main Branch QA main push 실행 조건이 유지되지 않았습니다.');
for (const group of [
  'online-core',
  'desktop-sequence',
  'desktop-regression',
  'mobile-galaxy',
  'mobile-galaxy-timing',
  'safari-visible-mismatch',
  'safari-timing',
]) {
  requireText(mainWorkflow, `- group: ${group}`, `Main Branch QA 필수 shard가 제거됐습니다: ${group}`);
}

for (const contract of [
  ['workflow_run:', 'Pages 배포가 Main Branch QA workflow_run을 사용하지 않습니다.'],
  ['workflows: [Main Branch QA]', 'Pages 배포가 Main Branch QA 이름을 정확히 참조하지 않습니다.'],
  ["github.event.workflow_run.conclusion == 'success'", 'Pages 배포가 성공한 QA만 허용하지 않습니다.'],
  ["github.event.workflow_run.event == 'push'", 'Pages 배포가 push QA만 허용하지 않습니다.'],
  ["github.event.workflow_run.head_branch == 'main'", 'Pages 배포가 main QA만 허용하지 않습니다.'],
  ['run-id: ${{ github.event.workflow_run.id }}', 'Pages 배포가 triggering QA artifact로 고정되지 않았습니다.'],
]) requireText(deployWorkflow, contract[0], contract[1]);

if (failures.length > 0) {
  console.error(`PR required QA architecture validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log('PR required QA architecture validation passed.');
