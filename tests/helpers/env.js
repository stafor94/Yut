import fs from 'node:fs/promises';
import path from 'node:path';

const firebaseConfigKeyMap = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

function parseFirebaseConfig(value) {
  if (!value) return {};

  const objectText = value.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\})\s*;?/)?.[1] ?? value;
  const jsonish = objectText
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'/g, '"')
    .replace(/,\s*}/g, '}');

  try {
    return JSON.parse(jsonish);
  } catch {
    return {};
  }
}

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
  const rawFirebaseConfig = readEnv('FIREBASE_CONFIG') || readEnv('FIREBASE');
  const parsedFirebaseConfig = parseFirebaseConfig(rawFirebaseConfig);
  const config = Object.fromEntries(Object.entries(firebaseConfigKeyMap).map(([firebaseKey, envKey]) => [
    firebaseKey,
    readEnv(envKey) || parsedFirebaseConfig[firebaseKey],
  ]));
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
