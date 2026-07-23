import { expect, test } from '@playwright/test';

test('QA browser app uses only the isolated Firebase emulators', async ({ page }) => {
  const consoleLines = [];
  page.on('console', (message) => consoleLines.push(message.text()));

  await page.goto('/');
  const runtime = await page.evaluate(() => window.__YUT_QA_FIREBASE__ ?? null);

  expect(runtime).not.toBeNull();
  expect(runtime.emulatorMode).toBe(true);
  expect(runtime.projectId).toBe(process.env.QA_PROJECT_ID);
  expect(runtime.qaRunId).toBe(process.env.QA_RUN_ID);
  expect(['127.0.0.1', 'localhost']).toContain(runtime.firestoreHost);
  expect(runtime.firestorePort).toBe(8080);
  expect(runtime.authUrl).toBe('http://127.0.0.1:9099');
  expect(consoleLines.some((line) => line.includes('[QA Firebase] Firestore emulator connected'))).toBe(true);
  expect(consoleLines.some((line) => line.includes('[QA Firebase] Auth emulator connected'))).toBe(true);
});
