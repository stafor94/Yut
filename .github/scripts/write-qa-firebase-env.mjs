import fs from 'node:fs';

const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const projectId = String(process.env.QA_PROJECT_ID ?? '').trim();

if (!qaRunId) throw new Error('QA_RUN_ID가 필요합니다.');
if (!/^demo-[a-z0-9-]+$/u.test(projectId)) throw new Error(`QA_PROJECT_ID는 demo- namespace여야 합니다: ${projectId || '없음'}`);

const values = {
  // Firebase 12.x validates the public API key shape before connecting to Auth Emulator.
  // This is a format-valid, non-production key used only by the isolated demo project.
  VITE_FIREBASE_API_KEY: 'AIzaSyA12345678901234567890123456789012',
  VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
  VITE_FIREBASE_PROJECT_ID: projectId,
  VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:qa-emulator',
  VITE_FIREBASE_EMULATOR_MODE: '1',
  VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
  VITE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  VITE_QA_RUN_ID: qaRunId,
  VITE_QA_ROLE: 'qa-emulator-suite',
};

const content = `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
fs.writeFileSync('.env.qa', content);
console.log(`Wrote isolated QA Firebase config for project=${projectId}, run=${qaRunId}`);
