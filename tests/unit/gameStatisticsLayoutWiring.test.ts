import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync('src/app/components/GameStatisticsDialog.tsx', 'utf8');
const flowSource = readFileSync('src/app/flows/gameStatistics.ts', 'utf8');
const dialogStyleSource = readFileSync('src/styles/game-statistics-dialog.css', 'utf8');
const footerSpacingFixSource = readFileSync('src/styles/game-statistics-footer-spacing-fix.css', 'utf8');
const timingStyleSource = readFileSync('src/styles/roll-timing-grades.css', 'utf8');
const timingTokenSource = readFileSync('src/styles/roll-timing-grade-tokens.css', 'utf8');
const mainSource = readFileSync('src/main.tsx', 'utf8');

test('통계 타이밍 배지는 실제 타이밍 막대의 PERFECT·NICE·GOOD·BAD 색상을 공유한다', () => {
  const gradeColors = {
    perfect: '#9568c7',
    nice: '#65b9d3',
    good: '#a9c96b',
    bad: '#302824',
  } as const;

  assert.match(timingTokenSource, /\.game-shell \.roll-timing-meter\s*\{/u);
  Object.entries(gradeColors).forEach(([grade, color]) => {
    assert.match(timingTokenSource, new RegExp(`--roll-timing-grade-${grade}: ${color}`));
    assert.match(timingStyleSource, new RegExp(color));
    assert.match(timingTokenSource, new RegExp(`var\\(--roll-timing-grade-${grade}\\)`));
    assert.match(dialogStyleSource, new RegExp(`var\\(--roll-timing-grade-${grade}\\)`));
  });
  assert.match(mainSource, /roll-timing-grades\.css'[\s\S]*roll-timing-grade-tokens\.css'[\s\S]*game-statistics-dialog\.css'[\s\S]*game-statistics-footer-spacing-fix\.css'/u);
});

test('팝업 전체와 하단 통계는 고정되고 기록 영역만 세로 스크롤된다', () => {
  assert.match(dialogStyleSource, /\.game-statistics-dialog\s*\{[\s\S]*?overflow-y:\s*hidden\s*!important;/u);
  assert.match(dialogStyleSource, /\.game-statistics-records\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/u);
  assert.doesNotMatch(dialogStyleSource, /\.game-statistics-footer\s*\{[^}]*overflow-y:\s*(?:auto|scroll)/u);
  assert.match(dialogStyleSource, /\.game-statistics-footer\s*\{[\s\S]*?padding:\s*12px 4px 10px;/u);
  assert.match(dialogStyleSource, /\.game-statistics-footer \.modal-actions\s*\{[\s\S]*?margin-top:\s*10px;/u);
  assert.match(footerSpacingFixSource, /\.game-statistics-dialog \.game-statistics-footer \.game-statistics-capture-count\s*\{[\s\S]*?margin:\s*8px 0 0;/u);
  assert.match(footerSpacingFixSource, /@media \(max-height: 720px\)[\s\S]*?margin-top:\s*6px;/u);
  assert.match(dialogStyleSource, /\.game-statistics-summary-grid\.timing\s*\{[\s\S]*?repeat\(4,/u);
});

test('기록은 기본 6열로 그룹화하고 부분 행 우측 정렬 로직 없이 왼쪽부터 렌더링한다', () => {
  assert.match(flowSource, /buildGameStatisticsRollGroups\([\s\S]*?columns = 6,/u);
  assert.match(flowSource, /normalizedColumns[\s\S]*?: 6;/u);
  assert.doesNotMatch(flowSource, /leadingEmptyColumns/u);
  assert.match(dialogStyleSource, /\.game-statistics-record-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,/u);
  assert.match(dialogStyleSource, /\.game-statistics-record-list\s*\{[\s\S]*?margin:\s*0;/u);
  assert.doesNotMatch(componentSource, /gridColumnStart/u);
  assert.doesNotMatch(componentSource, /leadingEmptyColumns/u);
});

test('기록 카드는 Sequence 걸침 배지·타이밍 첫 글자·윷 결과로 렌더링한다', () => {
  assert.match(dialogStyleSource, /\.game-statistics-sequence-badge\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?translate:\s*0 -52%;/u);
  assert.match(componentSource, /PERFECT:\s*'P'/u);
  assert.match(componentSource, /NICE:\s*'N'/u);
  assert.match(componentSource, /GOOD:\s*'G'/u);
  assert.match(componentSource, /BAD:\s*'B'/u);
  assert.match(componentSource, /aria-label=\{`타이밍 결과 \$\{record\.timing\}`\}/u);
  assert.match(componentSource, /game-statistics-yut-result/u);
});
