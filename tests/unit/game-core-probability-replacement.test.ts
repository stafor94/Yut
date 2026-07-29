import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const staleTimingContract = `test('윷 던지기 타이밍 구간은 중앙 Perfect와 좌우 Good을 판정한다', () => {
  assert.equal(getRollTimingZone(50), 'perfect');
  assert.equal(getRollTimingZone(40), 'good');
  assert.equal(getRollTimingZone(60), 'good');
  assert.equal(getRollTimingZone(20), 'normal');
});

test('AI 윷 던지기 타이밍은 30% Perfect, 40% Good, 30% Normal 기준으로 판정한다', () => {
  assert.equal(chooseAiRollTimingZone(() => 0.29), 'perfect');
  assert.equal(chooseAiRollTimingZone(() => 0.3), 'good');
  assert.equal(chooseAiRollTimingZone(() => 0.69), 'good');
  assert.equal(chooseAiRollTimingZone(() => 0.7), 'normal');
});

test('타이밍 구간별 낙 확률을 적용한다', () => {
  assert.equal(getFallChanceForTimingZone('perfect'), 0);
  assert.equal(getFallChanceForTimingZone('good'), 0.1);
  assert.equal(getFallChanceForTimingZone('normal'), 0.4);
});`;

const currentTimingContract = `test('윷 던지기 타이밍 구간은 Perfect, Nice, Good, Bad를 판정한다', () => {
  assert.equal(getRollTimingZone(50), 'perfect');
  assert.equal(getRollTimingZone(40), 'nice');
  assert.equal(getRollTimingZone(60), 'nice');
  assert.equal(getRollTimingZone(20), 'good');
  assert.equal(getRollTimingZone(0), 'bad');
});

test('기본 어려움 AI 윷 던지기 타이밍은 60% Perfect, 25% Nice, 10% Good, 5% Bad 기준으로 판정한다', () => {
  assert.equal(chooseAiRollTimingZone(() => 0.59), 'perfect');
  assert.equal(chooseAiRollTimingZone(() => 0.6), 'nice');
  assert.equal(chooseAiRollTimingZone(() => 0.85), 'good');
  assert.equal(chooseAiRollTimingZone(() => 0.95), 'bad');
});

test('타이밍 구간별 낙 확률은 Perfect 0%, Nice 5%, Good 20%, Bad와 legacy normal 70%다', () => {
  assert.equal(getFallChanceForTimingZone('perfect'), 0);
  assert.equal(getFallChanceForTimingZone('nice'), 0.05);
  assert.equal(getFallChanceForTimingZone('good'), 0.2);
  assert.equal(getFallChanceForTimingZone('bad'), 0.7);
  assert.equal(getFallChanceForTimingZone('normal'), 0.7);
});`;

const sourcePath = join(process.cwd(), 'tests/unit/game-core.cases.ts');
const source = readFileSync(sourcePath, 'utf8');
assert.equal(source.includes(staleTimingContract), true, 'game-core timing replacement target must remain exact');
const replacedSource = source.replace(staleTimingContract, currentTimingContract);
assert.equal(replacedSource.includes('30% Perfect, 40% Good, 30% Normal'), false);
assert.equal(replacedSource.includes("getFallChanceForTimingZone('good'), 0.1"), false);
assert.equal(replacedSource.includes("getFallChanceForTimingZone('normal'), 0.4"), false);

const replacementOutputPath = join(__dirname, 'game-core.current-contract.cases.js');
const transpiled = ts.transpileModule(replacedSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node16,
    esModuleInterop: true,
  },
  fileName: sourcePath,
  reportDiagnostics: true,
});
const errorDiagnostics = transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
assert.deepEqual(errorDiagnostics, []);
writeFileSync(replacementOutputPath, transpiled.outputText, 'utf8');
try {
  require(replacementOutputPath);
} finally {
  unlinkSync(replacementOutputPath);
}

test('game-core cases replacement removes obsolete timing boundaries before execution', () => {
  assert.equal(replacedSource.includes(currentTimingContract), true);
});
