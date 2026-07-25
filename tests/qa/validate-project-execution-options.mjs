import fs from 'node:fs';
import path from 'node:path';
import { qaProjectExecutionOptions, qaProjectNames } from './project-contracts.mjs';

const root = process.cwd();
const configSource = fs.readFileSync(path.join(root, 'playwright.config.js'), 'utf8');
const failures = [];
const expectedFullyParallel = Object.freeze({
  'desktop-chromium': false,
  'mobile-galaxy': false,
  'mobile-webkit-timing': true,
});

const optionNames = Object.keys(qaProjectExecutionOptions);
if (JSON.stringify(optionNames.sort()) !== JSON.stringify([...qaProjectNames].sort())) {
  failures.push(`project 실행 옵션 키가 testMatch project와 다릅니다: options=${optionNames.join(', ')}, projects=${qaProjectNames.join(', ')}`);
}

for (const projectName of qaProjectNames) {
  const options = qaProjectExecutionOptions[projectName];
  if (!options || typeof options.fullyParallel !== 'boolean') {
    failures.push(`${projectName}: fullyParallel boolean 계약이 없습니다.`);
    continue;
  }
  if (options.fullyParallel !== expectedFullyParallel[projectName]) {
    failures.push(`${projectName}: 검증된 fullyParallel 값과 다릅니다: ${String(options.fullyParallel)}`);
  }
  if (!configSource.includes(`fullyParallel: qaProjectExecutionOptions['${projectName}'].fullyParallel`)) {
    failures.push(`playwright.config.js가 공통 fullyParallel 계약을 사용하지 않습니다: ${projectName}`);
  }
}

if (!configSource.includes('fullyParallel: false,')) {
  failures.push('Playwright 전역 fullyParallel은 false로 유지해야 합니다. Safari timing project만 병렬화합니다.');
}

if (failures.length > 0) {
  console.error(`QA project execution validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`QA project execution validation passed: ${qaProjectNames.map((name) => `${name}=${String(qaProjectExecutionOptions[name].fullyParallel)}`).join(', ')}`);
