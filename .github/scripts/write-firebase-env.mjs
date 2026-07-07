import fs from 'node:fs';

const rawConfig = process.env.FIREBASE_CONFIG?.trim();
const keyMap = {
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
  return JSON.parse(jsonish);
}

const config = parseFirebaseConfig(rawConfig);
const lines = [];
for (const [firebaseKey, envKey] of Object.entries(keyMap)) {
  const value = process.env[envKey] || config[firebaseKey];
  if (value) lines.push(`${envKey}=${value}`);
}
fs.writeFileSync('.env.production', `${lines.join('\n')}\n`);
console.log(`Wrote ${lines.length} Firebase build variables to .env.production`);
