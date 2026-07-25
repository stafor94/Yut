import fs from 'node:fs';
import path from 'node:path';
import { makeQaName, QA_ROOM_TITLE_MAX_LENGTH } from './namespace.mjs';
import { createQaPlaywrightArgs } from './playwright-command.mjs';
import { qaProjectNames, qaProjectTestMatches } from './project-contracts.mjs';
import { qaSuiteManifest, qaSuiteNames } from './suite-manifest.mjs';

const root = process.cwd();
const failures = [];
const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const normalizePath = (value) => value.split(path.sep).join('/');
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const packageJson = JSON.parse(read('package.json'));
const playwrightConfig = read('playwright.config.js');
const runnerSource = read('tests/helpers/run-qa-emulator-suite.mjs');
const workflowSource = read('.github/workflows/qa.yml');
const seenTestTargets = new Map();
const concreteSpecs = new Map();

const namespaceSampleInfo = {
  project: { name: 'desktop-chromium' },
  testId: 'qa-architecture-namespace-sample',
  workerIndex: 3,
  parallelIndex: 2,
  retry: 0,
};
const namespaceSamples = Array.from({ length: 2_000 }, () => makeQaName(namespaceSampleInfo, 'parallel-room'));
if (new Set(namespaceSamples).size !== namespaceSamples.length) fail('병렬 QA room namespace sample에서 중복 이름이 발생했습니다.');
if (namespaceSamples.some((name) => name.length > QA_ROOM_TITLE_MAX_LENGTH || !/^QA-[a-z0-9-]+$/u.test(name))) {
  fail('병렬 QA room namespace가 방 제목 길이 또는 문자 계약을 위반합니다.');
}

function listSpecs(target) {
  const absolute = path.join(root, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return target.endsWith('.spec.js') ? [normalizePath(target)] : [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const nested = path.join(target, entry.name);
    return entry.isDirectory() ? listSpecs(nested) : nested.endsWith('.spec.js') ? [normalizePath(nested)] : [];
  });
}

function matchingProjects(specPath, projectNames) {
  return projectNames.filter((projectName) => (
    qaProjectTestMatches[projectName]?.some((matcher) => {
      matcher.lastIndex = 0;
      return matcher.test(specPath);
    })
  ));
}

for (const projectName of qaProjectNames) {
  if (!playwrightConfig.includes(`name: '${projectName}'`)) fail(`playwright.config.js에 project가 연결되지 않았습니다: ${projectName}`);
  if (!playwrightConfig.includes(`qaProjectTestMatches['${projectName}']`)) fail(`playwright.config.js가 공통 testMatch 계약을 사용하지 않습니다: ${projectName}`);
}

for (const suiteName of qaSuiteNames) {
  const suite = qaSuiteManifest[suiteName];
  if (suite.code !== ({ 'online-core': 'core', 'desktop-regression': 'desk', 'mobile-galaxy': 'mobile' })[suiteName]) {
    fail(`${suiteName}: workflow artifact code가 기존 summary 계약과 다릅니다: ${suite.code}`);
  }
  if (!Number.isInteger(suite.workers) || suite.workers < 1 || suite.workers > 4) {
    fail(`${suiteName}: workers는 1~4 정수여야 합니다: ${suite.workers}`);
  }
  if (!Array.isArray(suite.browsers) || suite.browsers.length === 0) fail(`${suiteName}: 설치할 Playwright browser가 필요합니다.`);
  if (suite.browsers?.some((browserName) => !['chromium', 'webkit'].includes(browserName))) fail(`${suiteName}: 지원하지 않는 Playwright browser가 있습니다: ${suite.browsers.join(', ')}`);
  if (!Array.isArray(suite.projects) || suite.projects.length === 0) fail(`${suiteName}: Playwright project가 필요합니다.`);
  for (const projectName of suite.projects ?? []) {
    if (!qaProjectTestMatches[projectName]) fail(`${suiteName}: 공통 project 계약에 없는 project입니다: ${projectName}`);
  }
  if (!Array.isArray(suite.tests) || suite.tests.length === 0) fail(`${suiteName}: 테스트 대상이 필요합니다.`);
  if (!suite.browserIsolationTest) fail(`${suiteName}: browser isolation test가 필요합니다.`);

  const commandArgs = createQaPlaywrightArgs(suiteName);
  if (commandArgs.filter((argument) => argument === 'playwright').length !== 1 || commandArgs.filter((argument) => argument === 'test').length !== 1) {
    fail(`${suiteName}: Playwright command prefix가 올바르지 않습니다.`);
  }
  if (!commandArgs.includes(`--workers=${suite.workers}`)) fail(`${suiteName}: runner command의 worker 수가 manifest와 다릅니다.`);
  for (const projectName of suite.projects ?? []) {
    if (commandArgs.filter((argument) => argument === `--project=${projectName}`).length !== 1) {
      fail(`${suiteName}: runner command의 project 연결이 올바르지 않습니다: ${projectName}`);
    }
  }

  const suiteTargets = [suite.browserIsolationTest, ...(suite.tests ?? [])];
  for (const target of suiteTargets) {
    if (commandArgs.filter((argument) => argument === target).length !== 1) fail(`${suiteName}: runner command에 target이 정확히 한 번 포함되지 않습니다: ${target}`);
  }
  for (const target of suiteTargets) {
    const absolute = path.join(root, target);
    if (!fs.existsSync(absolute)) fail(`${suiteName}: 테스트 대상이 없습니다: ${target}`);
    const owners = seenTestTargets.get(target) ?? [];
    owners.push(suiteName);
    seenTestTargets.set(target, owners);

    const specs = listSpecs(target);
    if (specs.length === 0) fail(`${suiteName}: 실행 가능한 .spec.js가 없습니다: ${target}`);
    for (const specPath of specs) {
      const projects = matchingProjects(specPath, suite.projects ?? []);
      if (projects.length === 0) fail(`${suiteName}: 선택된 Playwright project에서 실행되지 않는 spec입니다: ${specPath}`);
      const executions = concreteSpecs.get(specPath) ?? [];
      executions.push({ suiteName, projects });
      concreteSpecs.set(specPath, executions);
    }
  }
}

for (const [target, owners] of seenTestTargets) {
  if (target.includes('firebase-emulator-isolation.spec.js')) continue;
  if (owners.length > 1) fail(`테스트 대상이 여러 QA lane에 중복 등록됐습니다: ${target} -> ${owners.join(', ')}`);
}

for (const [specPath, executions] of concreteSpecs) {
  const seenExecutionKeys = new Set();
  for (const execution of executions) {
    for (const projectName of execution.projects) {
      const key = `${execution.suiteName}|${projectName}`;
      if (seenExecutionKeys.has(key)) fail(`같은 spec이 동일 lane/project에서 중복 실행됩니다: ${specPath} -> ${key}`);
      seenExecutionKeys.add(key);
    }
  }
}

const qaScripts = Object.entries(packageJson.scripts ?? {}).filter(([name]) => name.startsWith('test:qa-'));
if (qaScripts.length > 0) fail(`package.json에 테스트 파일 목록을 중복 보유한 legacy QA script가 남아 있습니다: ${qaScripts.map(([name]) => name).join(', ')}`);
if (/\.spec\.js/u.test(runnerSource)) fail('QA runner에 spec 경로를 직접 하드코딩하지 마세요. suite-manifest.mjs를 사용해야 합니다.');
if (/const\s+suiteGroups\s*=/u.test(runnerSource)) fail('QA runner에 legacy suiteGroups 정의가 남아 있습니다.');
if (workflowSource.includes('needs: build-and-unit')) fail('QA matrix가 build-and-unit 완료를 기다려 임계 경로를 직렬화하고 있습니다.');
if (workflowSource.includes('firebase-tools@latest')) fail('firebase-tools는 재현 가능한 고정 버전을 사용해야 합니다.');
for (const suiteName of qaSuiteNames) {
  const suite = qaSuiteManifest[suiteName];
  const matrixEntry = new RegExp(
    `- group: ${escapeRegex(suiteName)}\\n\\s+code: ${escapeRegex(suite.code)}\\n\\s+label: ${escapeRegex(suite.label)}\\n\\s+browsers: ${escapeRegex(suite.browsers.join(' '))}`,
    'u',
  );
  if (!matrixEntry.test(workflowSource)) fail(`qa.yml matrix 계약이 manifest와 다릅니다: ${suiteName}`);
}
if (!workflowSource.includes('npm run qa:validate-architecture')) fail('qa.yml build job이 QA architecture validator를 실행하지 않습니다.');
if (!workflowSource.includes('qa-duration.json')) fail('qa.yml artifact가 lane별 duration 보고서를 수집하지 않습니다.');

if (failures.length > 0) {
  console.error(`QA architecture validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

const executionCount = [...concreteSpecs.values()].reduce((total, entries) => (
  total + entries.reduce((nestedTotal, entry) => nestedTotal + entry.projects.length, 0)
), 0);
const report = {
  generatedAt: new Date().toISOString(),
  suites: Object.fromEntries(qaSuiteNames.map((suiteName) => {
    const suite = qaSuiteManifest[suiteName];
    return [suiteName, {
      code: suite.code,
      workers: suite.workers,
      browsers: suite.browsers,
      projects: suite.projects,
      targets: [suite.browserIsolationTest, ...suite.tests],
    }];
  })),
  specs: Object.fromEntries([...concreteSpecs].map(([specPath, executions]) => [specPath, executions])),
  totals: { suites: qaSuiteNames.length, specs: concreteSpecs.size, browserExecutions: executionCount, projects: qaProjectNames.length },
};
const reportPath = path.join(root, 'test-results', 'qa-architecture-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`QA architecture validation passed: suites=${qaSuiteNames.length}, specs=${concreteSpecs.size}, browserExecutions=${executionCount}, projects=${qaProjectNames.length}`);
