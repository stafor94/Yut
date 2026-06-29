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

const truncateText = (text, maxLength) => {
  if (!text || text.length <= maxLength) return text;
  const omitted = text.length - maxLength;
  return `${text.slice(0, maxLength)}

... ${omitted}자를 생략했습니다. 전체 로그는 Actions 아티팩트의 원본 파일을 확인해주세요.`;
};

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

function inferFailureCauses(playwrightLog, consoleLog) {
  const checks = [
    { pattern: /CREATE_ROOM_TIMEOUT/u, text: '방 생성 과정에서 `CREATE_ROOM_TIMEOUT`이 발생했습니다. Firebase 설정/네트워크 지연/방 생성 timeout 기준을 우선 확인하세요.' },
    { pattern: /getByTestId\('move-piece-button'\)|move-piece-button/u, text: '`move-piece-button`이 제한 시간 안에 활성화되지 않았습니다. `rollResultHolding`, 이동 가능 조건, 결과 확인 상태 해제 로직을 확인하세요.' },
    { pattern: /Executable doesn't exist|Please run the following command to download new browsers/u, text: 'Playwright 브라우저 바이너리가 없어 실행에 실패했습니다. `npx playwright install --with-deps` 단계 성공 여부를 확인하세요.' },
    { pattern: /npm run build|vite build|tsc -b/u, text: '빌드 단계 로그가 포함되어 있습니다. TypeScript/Vite 빌드 오류 여부를 확인하세요.' },
  ];
  return checks.filter(({ pattern }) => pattern.test(`${playwrightLog}\n${consoleLog}`)).map(({ text }) => text);
}

function extractFailureBlocks(playwrightLog) {
  const lines = playwrightLog.split(/\r?\n/u);
  const starts = [];
  lines.forEach((line, index) => {
    if (/^\s*\d+\)\s+\[[^\]]+\]/u.test(line)) starts.push(index);
  });
  return starts.slice(0, 8).map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    return truncateText(lines.slice(start, end).join('\n').trim(), 12_000);
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
const inferredCauses = inferFailureCauses(playwrightLog, consoleLog);

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

const inferredCauseSummary = [
  '## 자동 추정 실패 원인',
  '',
  inferredCauses.length > 0
    ? inferredCauses.map((cause) => `- ${cause}`).join('\n')
    : '로그 패턴만으로 실패 원인을 특정하지 못했습니다. 실패 상세 블록과 아티팩트를 확인해주세요.',
].join('\n');

const failureDetails = [
  '## 실패 상세 블록',
  '',
  failureBlocks.length > 0
    ? failureBlocks.map((block, index) => `### 실패 ${index + 1}\n\n${codeBlock(block)}`).join('\n\n')
    : 'Playwright 실패 상세 블록을 자동 추출하지 못했습니다.',
].join('\n');

const artifacts = [
  '## 추가 확인 대상',
  '',
  '- 아래 Issue 본문만으로 1차 원인 파악이 가능하도록 핵심 실패 상세를 포함합니다.',
  '- 원본 상세 로그와 실패 테스트 error-context가 더 필요할 때만 Actions 실행 페이지의 `qa-failure-summary` 아티팩트를 확인하세요.',
  `- test-results 파일 수: \`${walkFiles('test-results').length}\``,
  fs.existsSync('console-log.txt') ? '- console-log.txt: 생성됨' : '- console-log.txt: 없음',
].join('\n');

const consoleSummary = [
  '## 브라우저 콘솔 로그 마지막 80줄',
  '',
  codeBlock(lineTail(consoleLog, 80)),
].join('\n');

const logSummary = [
  buildLog ? ['### npm run build 마지막 80줄', '', codeBlock(lineTail(buildLog, 80))].join('\n') : '',
  playwrightLog ? ['### npx playwright test 마지막 120줄', '', codeBlock(lineTail(playwrightLog, 120))].join('\n') : '',
].filter(Boolean).join('\n\n') || '아직 빌드 또는 Playwright 로그가 생성되지 않았습니다. 실패한 이전 단계 로그를 확인해주세요.';

const issueFailureDetails = [
  '## Issue 본문용 실패 상세',
  '',
  failureBlocks.length > 0
    ? failureBlocks.slice(0, 3).map((block, index) => `### 실패 ${index + 1} 핵심 로그\n\n${codeBlock(truncateText(block, 6_000))}`).join('\n\n')
    : 'Playwright 실패 상세 블록을 자동 추출하지 못했습니다.',
  '',
  '### 브라우저 콘솔 마지막 40줄',
  '',
  codeBlock(lineTail(consoleLog, 40)),
  '',
  '### Playwright 로그 마지막 80줄',
  '',
  codeBlock(lineTail(playwrightLog, 80)),
].join('\n');

writeText('qa-environment.md', environment);
writeText('qa-failed-tests.md', failedTestsSummary);
writeText('qa-failure-details.md', failureDetails);
writeText('qa-artifacts.md', artifacts);
writeText('qa-console-summary.md', consoleSummary);
const issueSummary = [
  '## Game QA 실패 핵심 요약',
  '',
  `- 커밋: \`${(process.env.GITHUB_SHA ?? 'unknown').slice(0, 7)}\``,
  `- 브랜치/Ref: \`${process.env.GITHUB_REF_NAME ?? 'unknown'}\``,
  `- 이벤트: \`${process.env.GITHUB_EVENT_NAME ?? 'unknown'}\``,
  `- 실행 결과: ${runUrl}`,
  '',
  inferredCauseSummary,
  '',
  failedTestsSummary,
  '',
  issueFailureDetails,
  '',
  artifacts,
  '',
  '이 Issue 본문에 핵심 실패 로그와 콘솔 꼬리를 포함했습니다. 원본 상세 로그와 실패 테스트 error-context가 필요할 때만 Actions 아티팩트를 추가로 확인하세요.',
].join('\n');

writeText('qa-issue-summary.md', truncateText(issueSummary, 55_000));
writeText('qa-artifact-manifest.md', [
  formatFileList('test-results 파일 목록', 'test-results'),
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
  inferredCauseSummary,
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
