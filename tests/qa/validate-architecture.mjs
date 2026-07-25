import fs from 'node:fs';
import path from 'node:path';
import { qaSuiteManifest, qaSuiteNames } from './suite-manifest.mjs';

const root = process.cwd();
const failures = [];
const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const playwrightConfig = read('playwright.config.js');
const runnerSource = read('tests/helpers/run-qa-emulator-suite.mjs');
const workflowSource = read('.github/workflows/qa.yml');

const configuredProjects = new Set(
  [...playwrightConfig.matchAll(/name:\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]),
);
const seenTestTargets = new Map();

for (const suiteName of qaSuiteNames) {
  const suite = qaSuiteManifest[suiteName];
  if (suite.code !== ({ 'online-core': 'core', 'desktop-regression': 'desk', 'mobile-galaxy': 'mobile' })[suiteName]) {
    fail(`${suiteName}: workflow artifact code가 기존 summary 계약과 다릅니다: ${suite.code}`);
  }
  if (!Number.isInteger(suite.workers) || suite.workers < 1 || suite.workers > 4) {
    fail(`${suiteName}: workers는 1~4 정수여야 합니다: ${suite.workers}`);
  }
  if (!Array.isArray(suite.projects) || suite.projects.length === 0) fail(`${suiteName}: Playwright project가 필요합니다.`);
  for (const projectName of suite.projects ?? []) {
    if (!configuredProjects.has(projectName)) fail(`${suiteName}: playwright.config.js에 없는 project입니다: ${projectName}`);
  }
  if (!Array.isArray(suite.tests) || suite.tests.length === 0) fail(`${suiteName}: 테스트 대상이 필요합니다.`);
  for (const target of suite.tests ?? []) {
    const absolute = path.join(root, target);
    if (!fs.existsSync(absolute)) fail(`${suiteName}: 테스트 대상이 없습니다: ${target}`);
    const owners = seenTestTargets.get(target) ?? [];
    owners.push(suiteName);
    seenTestTargets.set(target, owners);
  }
}

for (const [target, owners] of seenTestTargets) {
  if (owners.length > 1) fail(`테스트 대상이 여러 QA lane에 중복 등록됐습니다: ${target} -> ${owners.join(', ')}`);
}

const qaScripts = Object.entries(packageJson.scripts ?? {}).filter(([name]) => name.startsWith('test:qa-'));
if (qaScripts.length > 0) fail(`package.json에 테스트 파일 목록을 중복 보유한 legacy QA script가 남아 있습니다: ${qaScripts.map(([name]) => name).join(', ')}`);
if (/\.spec\.js/u.test(runnerSource)) fail('QA runner에 spec 경로를 직접 하드코딩하지 마세요. suite-manifest.mjs를 사용해야 합니다.');
if (/const\s+suiteGroups\s*=/u.test(runnerSource)) fail('QA runner에 legacy suiteGroups 정의가 남아 있습니다.');
for (const suiteName of qaSuiteNames) {
  if (!workflowSource.includes(`group: ${suiteName}`)) fail(`qa.yml matrix에 manifest lane이 없습니다: ${suiteName}`);
}
if (!workflowSource.includes('npm run qa:validate-architecture')) fail('qa.yml build job이 QA architecture validator를 실행하지 않습니다.');

if (failures.length > 0) {
  console.error(`QA architecture validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

const targetCount = [...seenTestTargets].length;
console.log(`QA architecture validation passed: suites=${qaSuiteNames.length}, targets=${targetCount}, projects=${configuredProjects.size}`);
