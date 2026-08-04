import { copyFileSync, mkdirSync } from 'node:fs';
import test from 'node:test';

test('exports App source for the approved patch preparation branch', () => {
  mkdirSync('dist', { recursive: true });
  copyFileSync('src/app/App.tsx', 'dist/App.source.tsx');
});
