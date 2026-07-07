import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const testRoot = '.tmp-unit-tests';

function collectTestFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

let testFiles = [];

try {
  if (statSync(testRoot).isDirectory()) {
    testFiles = collectTestFiles(testRoot).sort();
  }
} catch {
  // The message below is the actionable failure for CI and local runs.
}

if (testFiles.length === 0) {
  console.error('No compiled unit test files found');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
