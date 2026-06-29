import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const readText = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
const writeText = (filePath, content) => fs.writeFileSync(filePath, `${content.replace(/\s+$/u, '')}\n`);
const commandOutput = (command, args = []) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
};
const lineTail = (text, count) => text.split(/\r?\n/u).slice(-count).join('\n').trim();
const codeBlock = (value) => value ? `\`\`\`text\n${value}\n\`\`\`` : '내용 없음';

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(nextPath);
      else results.push(nextPath);
    }
  }
  return results.sort();
}

function extractFailedTests(playwrightLog) {
  const failedTests = new Map();
  const pattern = /\d+\)\s+\[([^\]]+)\]\s+›\s+([^\n]+)/gu;
  for (const [, project, test] of playwrightLog.matchAll(pattern)) {
    failedTests.set(`${project} › ${test.trim()}`, { project, test: test.trim() });
  }
  return [...failedTests.values()];
}

function extractFailureBlocks(playwrightLog) {
  const lines = playwrightLog.split(/\r?\n/u);
  const starts = [];
  lines.forEach((line, index) => {
    if (/^\s*\d+\)\s+\[[^\]]+\]/u.test(line)) starts.push(index);
  });
  return starts.slice(0, 8).map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    return lines.slice(start, end).join('\n').trim();
  }).filter(Boolean);
}

function formatFileList(title, directory, limit = 80) {
  const files = walkFiles(directory);
  if (files.length === 0) return `## ${title}\n\n- ${directory}: 없음`;
  const listed = files.slice(0, limit).map((filePath) => {
    const stat = fs.statSync(filePath);
    return `- \`${filePath}\` (${stat.size} bytes)`;
  });
  const hiddenCount = files.length - listed.length;
  if (hiddenCount > 0) listed.push(`- ... 외 ${hiddenCount}개`);
  return `## ${title}\n\n${listed.join('\n')}`;
}

const buildLog = readText('build.log');
const playwrightLog = readText('playwright.log');
const consoleLog = readText('console-log.txt');
const runUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? ''}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
const failedTests = extractFailedTests(playwrightLog);
const failureBlocks = extractFailureBlocks(playwrightLog);

const environment = [
  '## 실행 환경',
  '',
  `- OS: \`${os.type()} ${os.release()} ${os.arch()}\``,
  `- Runner: \`${process.env.RUNNER_OS ?? 'unknown'} / ${process.env.RUNNER_ARCH ?? 'unknown'}\``,
  `- Node: \`${commandOutput('node', ['--version'])}\``,
  `- npm: \`${commandOutput('npm', ['--version'])}\``,
  `- Playwright: \`${commandOutput('npx', ['playwright', '--version'])}\``,
  `- 브랜치/Ref: \`${process.env.GITHUB_REF_NAME ?? 'unknown'}\``,
  `- 커밋: \`${process.env.GITHUB_SHA ?? 'unknown'}\``,
  `- 이벤트: \`${process.env.GITHUB_EVENT_NAME ?? 'unknown'}\``,
  `- 실행 번호: \`${process.env.GITHUB_RUN_NUMBER ?? 'unknown'}\``,
  `- 실행 ID: \`${process.env.GITHUB_RUN_ID ?? 'unknown'}\``,
  `- 실행 URL: ${runUrl}`,
].join('\n');

const failedTestsSummary = [
  '## 실패 테스트 후보',
  '',
  failedTests.length > 0
    ? failedTests.map(({ project, test }) => `- \`${project}\`: ${test}`).join('\n')
    : 'Playwright 로그에서 실패 테스트명을 자동 추출하지 못했습니다. 아래 원본 로그와 아티팩트를 확인해주세요.',
].join('\n');

const failureDetails = [
  '## 실패 상세 블록',
  '',
  failureBlocks.length > 0
    ? failureBlocks.map((block, index) => `### 실패 ${index + 1}\n\n${codeBlock(block)}`).join('\n\n')
    : 'Playwright 실패 상세 블록을 자동 추출하지 못했습니다.',
].join('\n');

const artifacts = [
  '## 첨부/확인 대상',
  '',
  '- Actions 실행 페이지의 `Artifacts`에서 `playwright-report`를 내려받으면 HTML 리포트, trace, video, screenshot, 원본 로그를 확인할 수 있습니다.',
  `- test-results 파일 수: \`${walkFiles('test-results').length}\``,
  `- playwright-report 파일 수: \`${walkFiles('playwright-report').length}\``,
  `- screenshots 파일 수: \`${walkFiles('screenshots').length}\``,
  fs.existsSync('console-log.txt') ? '- console-log.txt: 생성됨' : '- console-log.txt: 없음',
].join('\n');

const consoleSummary = [
  '## 브라우저 콘솔 로그 마지막 160줄',
  '',
  codeBlock(lineTail(consoleLog, 160)),
].join('\n');

const logSummary = [
  buildLog ? ['### npm run build 마지막 80줄', '', codeBlock(lineTail(buildLog, 80))].join('\n') : '',
  playwrightLog ? ['### npx playwright test 마지막 180줄', '', codeBlock(lineTail(playwrightLog, 180))].join('\n') : '',
].filter(Boolean).join('\n\n') || '아직 빌드 또는 Playwright 로그가 생성되지 않았습니다. 실패한 이전 단계 로그를 확인해주세요.';

writeText('qa-environment.md', environment);
writeText('qa-failed-tests.md', failedTestsSummary);
writeText('qa-failure-details.md', failureDetails);
writeText('qa-artifacts.md', artifacts);
writeText('qa-console-summary.md', consoleSummary);
writeText('qa-artifact-manifest.md', [
  formatFileList('test-results 파일 목록', 'test-results'),
  formatFileList('playwright-report 파일 목록', 'playwright-report'),
  formatFileList('screenshots 파일 목록', 'screenshots'),
].join('\n\n'));
writeText('qa-failure-summary.md', [
  '## Game QA 실행 요약',
  '',
  `- 커밋: \`${(process.env.GITHUB_SHA ?? 'unknown').slice(0, 7)}\``,
  `- 브랜치/Ref: \`${process.env.GITHUB_REF_NAME ?? 'unknown'}\``,
  `- 이벤트: \`${process.env.GITHUB_EVENT_NAME ?? 'unknown'}\``,
  `- 실행 결과: ${runUrl}`,
  '',
  environment,
  '',
  failedTestsSummary,
  '',
  failureDetails,
  '',
  artifacts,
  '',
  consoleSummary,
  '',
  '## 아티팩트 파일 목록',
  '',
  '자세한 파일 목록은 `qa-artifact-manifest.md`를 확인해주세요.',
  '',
  logSummary,
].join('\n'));
