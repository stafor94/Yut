import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadFileEnv() {
  const values = {};
  for (const fileName of ['.env.production', '.env.local', '.env']) {
    const filePath = path.join(process.cwd(), fileName);
    const content = await fs.readFile(filePath, 'utf8').catch(() => '');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return values;
}

export async function loadFirebaseConfig() {
  const fileEnv = await loadFileEnv();
  const readEnv = (key) => process.env[key] || fileEnv[key];
  const config = {
    apiKey: readEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readEnv('VITE_FIREBASE_APP_ID'),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

export async function hasFirebaseConfig() {
  return Boolean(await loadFirebaseConfig());
}

function formatQaTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}.${month}.${day}_${hours}${minutes}${seconds}`;
}

export function makeQaName(testInfo, suffix) {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'project';
  return `QA-${formatQaTimestamp()}-${project}-${suffix}`;
}
