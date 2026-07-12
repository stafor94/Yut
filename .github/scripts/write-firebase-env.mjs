import fs from 'node:fs';

const keyMap = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

const config = JSON.parse(fs.readFileSync('firebase.production.json', 'utf8'));
const missingKeys = Object.keys(keyMap).filter((key) => !String(config[key] ?? '').trim());
if (missingKeys.length) throw new Error(`firebase.production.json 필수 값이 없습니다: ${missingKeys.join(', ')}`);
if (config.projectId !== 'yut-online') throw new Error(`예상하지 못한 production Firebase projectId: ${config.projectId}`);
if (config.appId !== '1:925785463331:web:73ac57a5f7f8527455ef96') throw new Error(`예상하지 못한 production Firebase appId: ${config.appId}`);

const lines = Object.entries(keyMap).map(([firebaseKey, envKey]) => `${envKey}=${config[firebaseKey]}`);
fs.writeFileSync('.env.production', `${lines.join('\n')}\n`);
console.log(`Wrote canonical production Firebase config: project=${config.projectId}, appId=${config.appId}`);
