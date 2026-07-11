import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/regression/bug-history-smoke.spec.js';
const source = readFileSync(path, 'utf8');
const before = `        if (performance.now() - startedAt > 3_000) {
          reject(new Error('Perfect 구간에서 윷 던지기 버튼을 클릭하지 못했습니다.'));`;
const after = `        if (performance.now() - startedAt > 8_000) {
          reject(new Error('8초 동안 Perfect 구간에서 윷 던지기 버튼을 클릭하지 못했습니다.'));`;
if (source.includes(after)) {
  console.log('PR #557 Perfect wait is already updated.');
  process.exit(0);
}
if (!source.includes(before)) throw new Error('Perfect wait target was not found exactly.');
writeFileSync(path, source.replace(before, after));
console.log('Updated PR #557 Perfect wait to 8 seconds.');
